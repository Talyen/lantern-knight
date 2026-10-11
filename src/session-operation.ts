// Cancellation is an expected result when a newer session intent takes ownership.
export class SessionOperationCancelled extends Error {}

export class SessionOperation {
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
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => this.signal.removeEventListener('abort', abort);
      const abort = () => {
        cleanup();
        reject(this.signal.reason);
      };
      this.signal.addEventListener('abort', abort, { once: true });
      if (this.signal.aborted) abort();
      pending.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }
}
