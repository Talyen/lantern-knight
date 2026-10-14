// Bound transient image decode memory; shutdown settles queued callers immediately.
export class DecodeQueue {
  private active = 0;
  private closed = false;
  private waiting: { start: () => void; reject: (error: Error) => void }[] = [];
  constructor(private readonly limit = 6) {}
  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Image loader disposed'));
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        void Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            if (!this.closed) this.waiting.shift()?.start();
          });
      };
      if (this.active < this.limit) start();
      else this.waiting.push({ start, reject });
    });
  }
  dispose() {
    this.closed = true;
    for (const item of this.waiting.splice(0)) item.reject(new Error('Image loader disposed'));
  }
}
