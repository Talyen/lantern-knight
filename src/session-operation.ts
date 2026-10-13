import { readUntilAborted } from './abort';

// Cancellation is an expected result when a newer session intent takes ownership.
export class SessionOperationCancelled extends Error {}

// Work borrows cancellation state; only SessionOperations can cancel or replace it.
export interface SessionOperation {
  readonly signal: AbortSignal;
  check(): void;
  read<T>(pending: Promise<T>): Promise<T>;
}

class OwnedSessionOperation implements SessionOperation {
  private controller = new AbortController();
  get signal() {
    return this.controller.signal;
  }
  cancel(reason: string) {
    this.controller.abort(new SessionOperationCancelled(reason));
  }
  check() {
    this.signal.throwIfAborted();
  }
  // Storage reads own no resources and cannot be aborted by the bridge. Stop waiting
  // immediately, while still observing late rejection and discarding late data.
  read<T>(pending: Promise<T>): Promise<T> {
    return readUntilAborted(pending, this.signal);
  }
}

// Own admission as well as cancellation. Abort listeners run synchronously and
// may submit a newer intent or dispose the host before admission returns.
export class SessionOperations {
  private current?: OwnedSessionOperation;
  private disposed = false;

  get busy() {
    return this.current !== undefined;
  }

  async run<T>(work: (operation: SessionOperation) => Promise<T>): Promise<T> {
    if (this.disposed) throw new SessionOperationCancelled('application disposed');
    const previous = this.current,
      operation = new OwnedSessionOperation();
    // Claim ownership before invoking any callback belonging to the old owner.
    this.current = operation;
    try {
      previous?.cancel('session operation superseded');
      operation.check();
      const result = await work(operation);
      operation.check();
      return result;
    } catch (error) {
      operation.check();
      throw error;
    } finally {
      // Old completion must never clear a reentrant or overlapping successor.
      if (this.current === operation) this.current = undefined;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const operation = this.current;
    this.current = undefined;
    operation?.cancel('application disposed');
  }
}
