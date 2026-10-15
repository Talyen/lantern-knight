import type { AudioSample } from '../assets/audio';
import { readUntilAborted } from '../abort';
import { DecodeQueue } from '../assets/decode-queue';

type Entry = {
  lifetime: AbortController;
  promise: Promise<AudioBuffer>;
  bytes: number;
  refs: number;
  used: number;
};
export type AudioBufferLease = {
  readonly buffer: AudioBuffer;
  release(): void;
};

// Claims start before loading, so eviction cannot race an awaiting consumer.
// Playback transfers a claim to its voice; preload releases its temporary claim.
export class AudioBuffers {
  private readonly entries = new Map<string, Entry>();
  private readonly lifetime = new AbortController();
  private readonly decodes = new DecodeQueue(2, 'Audio buffers disposed');
  constructor(
    private readonly request: typeof fetch,
    private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
    private readonly now: () => number,
  ) {}
  get decodedBytes() {
    return [...this.entries.values()].reduce((bytes, entry) => bytes + entry.bytes, 0);
  }
  private evict() {
    let bytes = this.decodedBytes;
    for (const [key, entry] of [...this.entries].sort((a, b) => a[1].used - b[1].used)) {
      if (bytes <= 32 * 1024 ** 2) break;
      if (entry.refs || !entry.bytes) continue;
      this.entries.delete(key);
      bytes -= entry.bytes;
    }
  }
  private async load(sample: AudioSample, signal: AbortSignal) {
    signal.throwIfAborted();
    const response = await this.request('/' + sample.path, { signal });
    signal.throwIfAborted();
    if (!response.ok) throw new Error('sample missing: ' + sample.id);
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (hash !== sample.hash || bytes.byteLength !== sample.bytes)
      throw new Error('sample integrity: ' + sample.id);
    signal.throwIfAborted();
    const buffer = await this.decode(bytes);
    signal.throwIfAborted();
    return buffer;
  }
  async acquire(sample: AudioSample, signal?: AbortSignal): Promise<AudioBufferLease> {
    this.lifetime.signal.throwIfAborted();
    signal?.throwIfAborted();
    let entry = this.entries.get(sample.hash);
    if (!entry) {
      // Install the owner before invoking injected transport/decoder callbacks.
      const created: Entry = {
        lifetime: new AbortController(),
        bytes: 0,
        refs: 0,
        used: this.now(),
        promise: Promise.resolve().then(() =>
          this.decodes.run(
            () => this.load(sample, created.lifetime.signal),
            created.lifetime.signal,
          ),
        ),
      };
      created.promise = created.promise.then(
        (buffer) => {
          created.bytes = buffer.length * buffer.numberOfChannels * 4;
          this.evict();
          return buffer;
        },
        (error: unknown) => {
          if (this.entries.get(sample.hash) === created) this.entries.delete(sample.hash);
          throw error;
        },
      );
      this.entries.set(sample.hash, created);
      entry = created;
    }
    const held = entry;
    held.refs++;
    held.used = this.now();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      held.refs--;
      // Ready buffers remain cache-owned. Unfinished work has no owner once its
      // last borrower leaves: unregister before abort callbacks can re-enter.
      if (!held.refs && !held.bytes) {
        if (this.entries.get(sample.hash) === held) this.entries.delete(sample.hash);
        held.lifetime.abort();
      }
      this.evict();
    };
    const wait = AbortSignal.any([
      this.lifetime.signal,
      held.lifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    wait.addEventListener('abort', release, { once: true });
    try {
      // The entry owns late decodes; this wait borrows only its buffer. Lease
      // transfer happens after admission is checked, so cancellation leaks none.
      const buffer = await readUntilAborted(held.promise, wait);
      wait.throwIfAborted();
      return { buffer, release };
    } catch (error) {
      release();
      throw error;
    } finally {
      wait.removeEventListener('abort', release);
    }
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) entry.lifetime.abort();
    this.decodes.dispose();
  }
}
