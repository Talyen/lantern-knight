import type { AudioSample } from '../assets/audio';

type Entry = {
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
  private async load(sample: AudioSample) {
    this.lifetime.signal.throwIfAborted();
    const response = await this.request('/' + sample.path, { signal: this.lifetime.signal });
    if (!response.ok) throw new Error('sample missing: ' + sample.id);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
    if (hash !== sample.hash || bytes.byteLength !== sample.bytes)
      throw new Error('sample integrity: ' + sample.id);
    this.lifetime.signal.throwIfAborted();
    const buffer = await this.decode(bytes);
    this.lifetime.signal.throwIfAborted();
    return buffer;
  }
  async acquire(sample: AudioSample): Promise<AudioBufferLease> {
    this.lifetime.signal.throwIfAborted();
    let entry = this.entries.get(sample.hash);
    if (!entry) {
      // Install the owner before invoking injected transport/decoder callbacks.
      const created: Entry = {
        bytes: 0,
        refs: 0,
        used: this.now(),
        promise: Promise.resolve().then(() => this.load(sample)),
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
      this.evict();
    };
    try {
      const buffer = await held.promise;
      this.lifetime.signal.throwIfAborted();
      return { buffer, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.entries.clear();
  }
}
