type ImageLoad = { promise: Promise<HTMLImageElement>; cancel: () => void };
type Entry = {
  source: string;
  resolve: (image: HTMLImageElement) => void;
  reject: (error: unknown) => void;
  promise: Promise<HTMLImageElement>;
  load?: ImageLoad;
};

function loadImage(source: string): ImageLoad {
  const image = new Image();
  let reject!: (error: unknown) => void;
  const clear = () => {
    image.onload = null;
    image.onerror = null;
  };
  const promise = new Promise<HTMLImageElement>((resolve, fail) => {
    reject = fail;
    image.onload = () => {
      clear();
      resolve(image);
    };
    image.onerror = () => {
      clear();
      fail(new Error(`Preview image unavailable: ${source}`));
    };
    image.src = source;
  });
  return {
    promise,
    cancel: () => {
      clear();
      image.removeAttribute('src');
      reject(new Error('Preview images disposed'));
    },
  };
}

// All editor thumbnails and animated previews share one decode/cache lifetime.
// A canvas accepts only its latest request, even when pages finish out of order.
export class PreviewImages {
  private readonly ready = new Map<string, HTMLImageElement>();
  private readonly pending = new Map<string, Entry>();
  private readonly queue: Entry[] = [];
  private latest = new WeakMap<HTMLCanvasElement, object>();
  private displayed = new WeakMap<HTMLCanvasElement, { source: string; image: HTMLImageElement }>();
  private active = 0;
  private readyBytes = 0;
  private closed = false;
  constructor(private readonly load: (source: string) => ImageLoad = loadImage) {}

  async draw(target: HTMLCanvasElement, source: string, paint: (image: HTMLImageElement) => void) {
    if (this.closed) return;
    const request = {};
    this.latest.set(target, request);
    try {
      // Keep the displayed page with its canvas: an atlas larger than the cache
      // budget must not reload on every animation frame. Weak keys do not retain
      // removed palette canvases, and shutdown clears the whole displayed set.
      const displayed = this.displayed.get(target);
      const image = await (displayed?.source === source
        ? Promise.resolve(displayed.image)
        : this.acquire(source));
      if (!this.closed && target.isConnected && this.latest.get(target) === request) {
        this.displayed.set(target, { source, image });
        paint(image);
      }
    } catch (error) {
      if (!this.closed && this.latest.get(target) === request) throw error;
    }
  }

  private acquire(source: string) {
    const cached = this.ready.get(source);
    if (cached) {
      this.ready.delete(source);
      this.ready.set(source, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(source);
    if (pending) return pending.promise;
    let resolve!: Entry['resolve'], reject!: Entry['reject'];
    const promise = new Promise<HTMLImageElement>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    const entry = { source, promise, resolve, reject };
    this.pending.set(source, entry);
    this.queue.push(entry);
    this.pump();
    return promise;
  }

  private pump() {
    while (!this.closed && this.active < 6 && this.queue.length) {
      const entry = this.queue.shift()!;
      this.active++;
      // Invoke injected loaders inside a promise so synchronous failures settle too.
      void Promise.resolve()
        .then(() => {
          if (this.closed) throw new Error('Preview images disposed');
          entry.load = this.load(entry.source);
          return entry.load.promise;
        })
        .then(
          (image) => {
            if (!this.closed) {
              this.ready.set(entry.source, image);
              this.readyBytes += image.naturalWidth * image.naturalHeight * 4;
              // Count decoded pixels, not compressed transfer bytes. Full-resolution
              // preview atlases can be far larger than palette thumbnails.
              while (this.ready.size > 48 || this.readyBytes > 64 * 1024 * 1024) {
                const oldest = this.ready.keys().next().value!;
                const removed = this.ready.get(oldest)!;
                this.ready.delete(oldest);
                this.readyBytes -= removed.naturalWidth * removed.naturalHeight * 4;
              }
            }
            this.pending.delete(entry.source);
            entry.resolve(image);
          },
          (error: unknown) => {
            this.pending.delete(entry.source);
            entry.reject(error);
          },
        )
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.latest = new WeakMap();
    this.displayed = new WeakMap();
    this.ready.clear();
    this.readyBytes = 0;
    this.queue.length = 0;
    for (const entry of this.pending.values()) {
      entry.reject(new Error('Preview images disposed'));
      entry.load?.cancel();
    }
    this.pending.clear();
  }
}
