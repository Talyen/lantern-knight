type Entry<T> = {
  refs: number;
  promise: Promise<T>;
  state: { kind: 'pending' } | { kind: 'ready'; value: T } | { kind: 'disposed' };
};

/** Leases share resources within one lifetime. Closing the owner invalidates every lease. */
export class ResourcePool<T> {
  private entries = new Map<string, Entry<T>>();
  private closed = false;
  constructor(
    private load: (id: string) => Promise<T>,
    private destroy: (value: T) => void,
  ) {}
  get size() {
    return this.entries.size;
  }
  private assertActive() {
    if (this.closed) throw new Error('Resource pool disposed');
  }
  private discard(id: string, entry: Entry<T>) {
    const state = entry.state;
    entry.state = { kind: 'disposed' };
    if (this.entries.get(id) === entry) this.entries.delete(id);
    if (state.kind === 'ready') this.destroy(state.value);
  }
  private retain(id: string) {
    this.assertActive();
    let entry = this.entries.get(id);
    if (!entry) {
      // The async wrapper also turns synchronous loader failures into rejected leases.
      const loading = (async () => this.load(id))();
      const created: Entry<T> = {
        refs: 0,
        state: { kind: 'pending' },
        promise: loading.then(
          (value) => {
            if (created.state.kind === 'disposed' || created.refs === 0 || this.closed) {
              this.discard(id, created);
              this.destroy(value);
            } else created.state = { kind: 'ready', value };
            return value;
          },
          (error) => {
            this.discard(id, created);
            throw error;
          },
        ),
      };
      this.entries.set(id, created);
      entry = created;
    }
    entry.refs++;
    const held = entry;
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        held.refs--;
        if (held.refs === 0) this.discard(id, held);
      },
    };
  }
  async acquire(
    ids: string[],
    signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ) {
    this.assertActive();
    if (signal?.aborted) throw new Error('load cancelled');
    const leases = [...new Set(ids)].map((id) => [id, this.retain(id)] as const);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const [, lease] of leases) lease.release();
    };
    signal?.addEventListener('abort', release, { once: true });
    let done = 0;
    try {
      const results = await Promise.allSettled(
        leases.map(async ([id, lease]) => {
          try {
            const value = await lease.promise;
            this.assertActive();
            if (signal?.aborted) throw new Error('load cancelled');
            onProgress?.(++done, leases.length);
            return [id, value] as const;
          } catch (error) {
            release();
            throw error;
          }
        }),
      );
      this.assertActive();
      if (signal?.aborted) throw new Error('load cancelled');
      const resources = new Map<string, T>();
      for (const result of results) {
        if (result.status === 'rejected') throw result.reason;
        resources.set(...result.value);
      }
      return { resources, release };
    } catch (error) {
      release();
      throw error;
    } finally {
      signal?.removeEventListener('abort', release);
    }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const [id, entry] of this.entries) this.discard(id, entry);
  }
}
