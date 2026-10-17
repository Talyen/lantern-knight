import { readUntilAborted } from './abort';

type Entry<T> = {
  lifetime: AbortController;
  promise: Promise<T>;
  refs: number;
  bytes?: number;
};
export type ResourceLease<T> = { readonly value: T; release(): void };

// Pending work belongs to its readers; ready values belong to a bounded LRU cache.
// Values are managed memory, with no external destructor (buffers, bytes and images).
export class ResourceCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly lifetime = new AbortController();
  private retainedBytes = 0;
  constructor(
    private readonly weight: (value: T) => number,
    private readonly budget: number,
    private readonly capacity = Infinity,
  ) {}
  get bytes() {
    return this.retainedBytes;
  }
  private evict() {
    for (const [key, entry] of this.entries) {
      if (this.retainedBytes <= this.budget && this.entries.size <= this.capacity) break;
      if (entry.refs || entry.bytes === undefined) continue;
      this.entries.delete(key);
      this.retainedBytes -= entry.bytes;
    }
  }
  async acquire(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<ResourceLease<T>> {
    this.lifetime.signal.throwIfAborted();
    signal?.throwIfAborted();
    let entry = this.entries.get(key);
    if (!entry) {
      // Register ownership before any loader or decoder can re-enter.
      const created: Entry<T> = {
        lifetime: new AbortController(),
        refs: 0,
        promise: Promise.resolve().then(() => {
          created.lifetime.signal.throwIfAborted();
          return load(created.lifetime.signal);
        }),
      };
      created.promise = created.promise
        .then((value) => {
          created.lifetime.signal.throwIfAborted();
          const bytes = this.weight(value);
          created.lifetime.signal.throwIfAborted();
          created.bytes = bytes;
          this.retainedBytes += bytes;
          this.evict();
          return value;
        })
        .catch((error: unknown) => {
          if (this.entries.get(key) === created) this.entries.delete(key);
          throw error;
        });
      entry = created;
    }
    // Map order is access order, independent of wall clocks or equal timestamps.
    this.entries.delete(key);
    this.entries.set(key, entry);
    const held = entry;
    held.refs++;
    let released = false;
    const wait = AbortSignal.any([
      this.lifetime.signal,
      held.lifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    const release = () => {
      if (released) return;
      released = true;
      if (--held.refs === 0 && held.bytes === undefined) {
        // Retire before abort listeners can synchronously request a successor.
        if (this.entries.get(key) === held) this.entries.delete(key);
        held.lifetime.abort();
      }
      this.evict();
    };
    wait.addEventListener('abort', release, { once: true });
    try {
      const value = await readUntilAborted(held.promise, wait);
      wait.throwIfAborted();
      return { value, release };
    } catch (error) {
      release();
      throw error;
    } finally {
      wait.removeEventListener('abort', release);
    }
  }
  dispose() {
    if (this.lifetime.signal.aborted) return;
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.retainedBytes = 0;
    this.lifetime.abort();
    for (const entry of entries) entry.lifetime.abort();
  }
}
