import { acquireBatch } from './acquire-batch';
import { cleanupAll, cleanupAfterFailure } from './cleanup';
type Entry<T> = {
  lifetime: AbortController;
  refs: number;
  promise: Promise<T>;
  start: () => void;
  state: { kind: 'pending' } | { kind: 'ready'; value: T } | { kind: 'disposed' };
};

/** Leases share resources within one lifetime. Closing the owner invalidates every lease. */
export class ResourcePool<T> {
  private entries = new Map<string, Entry<T>>();
  private closed = false;
  private readonly lifetime = new AbortController();
  constructor(
    private load: (id: string, signal: AbortSignal) => Promise<T>,
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
    entry.lifetime.abort(new Error(this.closed ? 'Resource pool disposed' : 'load cancelled'));
    if (state.kind === 'ready') this.destroy(state.value);
  }
  private retain(id: string) {
    this.assertActive();
    let entry = this.entries.get(id);
    if (!entry) {
      // Admission creates ownership without calling external code. Every batch
      // claim and its cancellation listener must exist before any loader runs.
      const loading = Promise.withResolvers<T>();
      let started = false;
      const created: Entry<T> = {
        lifetime: new AbortController(),
        refs: 0,
        state: { kind: 'pending' },
        start: () => {
          if (started) return;
          started = true;
          if (this.closed || created.state.kind === 'disposed') {
            loading.reject(new Error(this.closed ? 'Resource pool disposed' : 'load cancelled'));
            return;
          }
          try {
            loading.resolve(this.load(id, created.lifetime.signal));
          } catch (error) {
            loading.reject(error);
          }
        },
        promise: loading.promise.then(
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
      start: entry.start,
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
    const leases = new Map([...new Set(ids)].map((id) => [id, this.retain(id)]));
    try {
      const held = await acquireBatch(
        leases.keys(),
        async (id, signal) => {
          const lease = leases.get(id)!;
          signal.throwIfAborted();
          lease.start();
          const value = await lease.promise;
          signal.throwIfAborted();
          return { value, release: lease.release };
        },
        (lease) => lease.release(),
        AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]),
        onProgress,
        () => cleanupAll([...leases.values()].map((lease) => lease.release)),
      );
      return {
        resources: new Map([...held.resources].map(([id, lease]) => [id, lease.value])),
        release: held.release,
      };
    } catch (error) {
      cleanupAfterFailure(error, () =>
        cleanupAll([...leases.values()].map((lease) => lease.release)),
      );
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort(new Error('Resource pool disposed'));
    cleanupAll(
      [...this.entries].map(
        ([id, entry]) =>
          () =>
            this.discard(id, entry),
      ),
    );
  }
}
