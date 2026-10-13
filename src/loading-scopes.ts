import { cleanupAfterFailure } from './assets/cleanup';

// Loading blocks interaction only while a request is relevant. Work retains its
// resource ownership until settlement, even after cancellation retires its scope.
export class LoadingScopes {
  private scopes = new Set<() => void>();
  private announced = false;
  private closed = false;
  constructor(
    private readonly start: () => void,
    private readonly idle: () => void,
    private readonly report: (error: unknown) => void,
  ) {}
  get busy() {
    return this.scopes.size > 0;
  }
  private reveal() {
    if (this.closed || this.busy || !this.announced) return;
    this.announced = false;
    this.idle();
  }
  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) throw new Error('Loading scopes disposed');
    signal?.throwIfAborted();
    const detach = () => {
      signal?.removeEventListener('abort', cancel);
      return this.scopes.delete(detach);
    };
    const finish = () => {
      if (detach()) this.reveal();
    };
    const cancel = () => {
      if (!detach()) return;
      // Session admission aborts its predecessor before entering the successor's
      // scope. Let synchronous admission finish before revealing an idle screen.
      queueMicrotask(() => {
        try {
          this.reveal();
        } catch (error) {
          // Cancellation notification must not throw from EventTarget dispatch.
          try {
            this.report(error);
          } catch {
            // Host diagnostics cannot reopen or strand a retired scope.
          }
        }
      });
    };
    this.scopes.add(detach);
    signal?.addEventListener('abort', cancel, { once: true });
    let result: T;
    try {
      if (!this.announced) {
        this.announced = true;
        this.start();
      }
      if (this.closed) throw new Error('Loading scopes disposed');
      signal?.throwIfAborted();
      result = await work();
    } catch (error) {
      cleanupAfterFailure(error, finish);
    }
    finish();
    return result;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const detach of this.scopes) detach();
    this.announced = false;
  }
}
