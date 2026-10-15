import type { AudioSample } from '../assets/audio';
import { ResourceCache } from '../assets/resource-cache';
import { sha256 } from '../assets/bitmap';
import { DecodeQueue } from '../assets/decode-queue';

export type AudioBufferLease = {
  readonly buffer: AudioBuffer;
  release(): void;
};

// Claims start before loading, so eviction cannot race an awaiting consumer.
// Playback transfers a claim to its voice; preload releases its temporary claim.
export class AudioBuffers {
  private readonly cache = new ResourceCache<AudioBuffer>(
    (buffer) => buffer.length * buffer.numberOfChannels * 4,
    32 * 1024 ** 2,
  );
  private readonly decodes = new DecodeQueue(2, 'Audio buffers disposed');
  constructor(
    private readonly request: typeof fetch,
    private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
  ) {}
  get decodedBytes() {
    return this.cache.bytes;
  }
  private async load(sample: AudioSample, signal: AbortSignal) {
    signal.throwIfAborted();
    const response = await this.request('/' + sample.path, { signal });
    signal.throwIfAborted();
    if (!response.ok) throw new Error('sample missing: ' + sample.id);
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const hash = await sha256(bytes);
    if (hash !== sample.hash || bytes.byteLength !== sample.bytes)
      throw new Error('sample integrity: ' + sample.id);
    signal.throwIfAborted();
    const buffer = await this.decode(bytes);
    signal.throwIfAborted();
    return buffer;
  }
  async acquire(sample: AudioSample, signal?: AbortSignal): Promise<AudioBufferLease> {
    const held = await this.cache.acquire(
      sample.hash,
      (signal) => this.decodes.run(() => this.load(sample, signal), signal),
      signal,
    );
    return { buffer: held.value, release: () => held.release() };
  }
  dispose() {
    this.cache.dispose();
    this.decodes.dispose();
  }
}
