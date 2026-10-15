import { readUntilAborted } from '../assets/abort';
import { DecodeQueue } from '../assets/decode-queue';
type ImageLoad = { promise: Promise<HTMLImageElement>; cancel: () => void };
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
  private readonly pending = new Map<string, Promise<HTMLImageElement>>();
  private readonly activeLoads = new Set<ImageLoad>();
  private readonly decodes = new DecodeQueue(6);
  private latest = new WeakMap<HTMLCanvasElement, object>();
  private readonly playbacks = new Set<Playback>();
  private readyBytes = 0;
  private readonly lifetime = new AbortController();
  private get closed() {
    return this.lifetime.signal.aborted;
  }
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
    if (pending) return pending;
    const promise = this.decodes
      .run(async () => {
        if (this.closed) throw new Error('Preview images disposed');
        const load = this.load(source);
        this.activeLoads.add(load);
        try {
          const image = await readUntilAborted(load.promise, this.lifetime.signal);
          if (!this.closed) {
            this.ready.set(source, image);
            this.readyBytes += image.naturalWidth * image.naturalHeight * 4;
            while (this.ready.size > 48 || this.readyBytes > 64 * 1024 * 1024) {
              const oldest = this.ready.keys().next().value!;
              const removed = this.ready.get(oldest)!;
              this.ready.delete(oldest);
              this.readyBytes -= removed.naturalWidth * removed.naturalHeight * 4;
            }
          }
          return image;
        } finally {
          this.activeLoads.delete(load);
        }
      })
      .finally(() => this.pending.delete(source));
    this.pending.set(source, promise);
    return promise;
  }

  dispose() {
    if (this.closed) return;
    this.lifetime.abort();
    this.latest = new WeakMap();
    for (const playback of this.playbacks) {
      playback.active = false;
      playback.displayed = undefined;
    }
    this.playbacks.clear();
    this.ready.clear();
    this.readyBytes = 0;
    this.decodes.dispose();
    for (const load of this.activeLoads) load.cancel();
    this.activeLoads.clear();
    this.pending.clear();
  }
}
