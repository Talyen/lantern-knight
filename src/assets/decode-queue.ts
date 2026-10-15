// Bound acquisition/decode work; active native work retains its slot until settlement.
export class DecodeQueue {
  private active = 0;
  private closed = false;
  private waiting: { start: () => void; reject: (error: Error) => void }[] = [];
  constructor(
    private readonly limit = 6,
    private readonly disposedMessage = 'Image loader disposed',
  ) {}
  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(new Error(this.disposedMessage));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      const item = {
        start: () => start(),
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
      };
      const cancel = () => {
        this.waiting = this.waiting.filter((queued) => queued !== item);
        cleanup();
        reject(signal!.reason);
      };
      const start = () => {
        cleanup();
        this.active++;
        void Promise.resolve()
          .then(() => {
            signal?.throwIfAborted();
            return work();
          })
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            if (!this.closed) this.waiting.shift()?.start();
          });
      };
      if (this.active < this.limit) start();
      else {
        this.waiting.push(item);
        signal?.addEventListener('abort', cancel, { once: true });
      }
    });
  }
  dispose() {
    this.closed = true;
    for (const item of this.waiting.splice(0)) item.reject(new Error(this.disposedMessage));
  }
}
