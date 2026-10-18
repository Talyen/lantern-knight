import { readUntilAborted } from './assets/abort';

// Cancellation is an expected result when a newer session intent takes ownership.
export class SessionOperationCancelled extends Error {}

// Own admission as well as cancellation. Abort listeners run synchronously and
// may submit a newer intent or dispose the host before admission returns.
export class SessionOperations {
  private current?: { controller: AbortController; exclusive?: string };
  private disposed = false;

  get exclusive() {
    return this.current?.exclusive !== undefined;
  }

  get busy() {
    return this.current !== undefined;
  }

  // Command completion transfers only an outcome. The body retains acquisition
  // ownership and must check admission before committing or invoking host code.
  async run<T extends void | boolean>(
    work: (signal: AbortSignal) => Promise<T>,
    exclusive?: string,
  ): Promise<T> {
    if (this.disposed) throw new SessionOperationCancelled('application disposed');
    if (this.current?.exclusive !== undefined)
      throw new Error(`Wait for ${this.current.exclusive} to finish saving`);
    const previous = this.current,
      operation = { controller: new AbortController(), exclusive },
      signal = operation.controller.signal;
    // Claim ownership before invoking any callback belonging to the old owner.
    this.current = operation;
    try {
      previous?.controller.abort(new SessionOperationCancelled('session operation superseded'));
      signal.throwIfAborted();
      // Cancellation settles the caller even if a native decode never settles.
      // Observe the body through its eventual cleanup; its guards still revoke
      // commit, and its finally blocks still release resources arriving later.
      const result = await readUntilAborted(work(signal), signal);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
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
    operation?.controller.abort(new SessionOperationCancelled('application disposed'));
  }
}
