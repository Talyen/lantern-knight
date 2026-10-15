type ImageLoad = { promise: Promise<HTMLImageElement>; cancel: () => void };
type Entry = PromiseWithResolvers<HTMLImageElement> & { source: string; load?: ImageLoad };
type Playback = { active: boolean; displayed?: { source: string; image: HTMLImageElement } };
export type PreviewPlayback = {
  draw(source: string, paint: (image: HTMLImageElement) => void): Promise<void>;
  dispose(): void;
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
  private readonly playbacks = new Set<Playback>();
  private active = 0;
  private readyBytes = 0;
  private closed = false;
  constructor(private readonly load: (source: string) => ImageLoad = loadImage) {}

  // Only an open animation owns a displayed source outside the bounded cache.
  // Thumbnails already contain their painted pixels and need no source lease.
  playback(target: HTMLCanvasElement): PreviewPlayback {
    const playback: Playback = { active: !this.closed };
    if (playback.active) this.playbacks.add(playback);
    return {
      draw: (source, paint) => this.paint(target, source, paint, playback),
      dispose: () => {
        playback.active = false;
        playback.displayed = undefined;
        this.playbacks.delete(playback);
      },
    };
  }

  draw(target: HTMLCanvasElement, source: string, paint: (image: HTMLImageElement) => void) {
    return this.paint(target, source, paint);
  }

  private async paint(
    target: HTMLCanvasElement,
    source: string,
    paint: (image: HTMLImageElement) => void,
    playback?: Playback,
  ) {
    const active = () => !this.closed && (!playback || playback.active);
    if (!active()) return;
    const request = {};
    this.latest.set(target, request);
    try {
      // A leased atlas larger than the cache budget must not reload each frame.
      const displayed = playback?.displayed;
      const image = await (displayed?.source === source
        ? Promise.resolve(displayed.image)
        : this.acquire(source));
      if (active() && target.isConnected && this.latest.get(target) === request) {
        if (playback) playback.displayed = { source, image };
        paint(image);
      }
    } catch (error) {
      if (active() && this.latest.get(target) === request) throw error;
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
    const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
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
    for (const playback of this.playbacks) {
      playback.active = false;
      playback.displayed = undefined;
    }
    this.playbacks.clear();
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
