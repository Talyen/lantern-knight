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
      const start = () => {
        signal?.removeEventListener('abort', cancel);
        this.active++;
        void Promise.resolve()
          .then(() => {
            if (this.closed) throw new Error(this.disposedMessage);
            signal?.throwIfAborted();
            return work();
          })
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            if (!this.closed) this.waiting.shift()?.start();
          });
      };
      const cancel = () => {
        this.waiting = this.waiting.filter((queued) => queued !== item);
        reject(signal!.reason);
      };
      const item = {
        start,
        reject: (error: Error) => {
          signal?.removeEventListener('abort', cancel);
          reject(error);
        },
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
