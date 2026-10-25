// Bound acquisition/decode work; active native work retains its slot until settlement.
export class DecodeQueue {
  private active = 0;
  private activeBytes = 0;
  private closed = false;
  private waiting: { bytes: number; start: () => void; reject: (error: Error) => void }[] = [];
  constructor(
    private readonly limit = 6,
    private readonly disposedMessage = 'Image loader disposed',
    private readonly byteBudget = Infinity,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || !(byteBudget > 0))
      throw new Error('Invalid decode admission budget');
  }
  private drain() {
    while (!this.closed && this.active < this.limit && this.waiting.length) {
      const next = this.waiting[0]!;
      // A supported large image may exceed the estimate budget, but runs alone.
      if (this.active && this.activeBytes + next.bytes > this.byteBudget) break;
      this.waiting.shift()!.start();
    }
  }
  run<T>(work: () => Promise<T>, signal?: AbortSignal, bytes = 1): Promise<T> {
    if (this.closed) return Promise.reject(new Error(this.disposedMessage));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!Number.isFinite(bytes) || bytes <= 0)
      return Promise.reject(new Error('Invalid decode memory estimate'));
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener('abort', cancel);
        this.active++;
        this.activeBytes += bytes;
        void Promise.resolve()
          .then(() => {
            if (this.closed) throw new Error(this.disposedMessage);
            signal?.throwIfAborted();
            return work();
          })
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.activeBytes -= bytes;
            this.drain();
          });
      };
      const cancel = () => {
        this.waiting = this.waiting.filter((queued) => queued !== item);
        reject(signal!.reason);
        this.drain();
      };
      const item = {
        bytes,
        start,
        reject: (error: Error) => {
          signal?.removeEventListener('abort', cancel);
          reject(error);
        },
      };
      this.waiting.push(item);
      signal?.addEventListener('abort', cancel, { once: true });
      this.drain();
    });
  }
  dispose() {
    this.closed = true;
    for (const item of this.waiting.splice(0)) item.reject(new Error(this.disposedMessage));
  }
}
