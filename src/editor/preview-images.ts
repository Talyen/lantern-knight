import { readUntilAborted } from '../assets/abort';
import { DecodeQueue } from '../assets/decode-queue';
import { cleanupAfterFailure } from '../assets/cleanup';
type ImageLoad = { promise: Promise<HTMLImageElement>; cancel: () => void };
type Playback = {
  active: boolean;
  requests: Set<AbortController>;
  displayed?: { source: string; image: HTMLImageElement };
};
type PendingImage = {
  controller: AbortController;
  readers: number;
  promise: Promise<HTMLImageElement>;
};
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
  private readonly pending = new Map<string, PendingImage>();
  private readonly decodes = new DecodeQueue(6);
  private latest = new WeakMap<HTMLCanvasElement, AbortController>();
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
    const playback: Playback = { active: !this.closed, requests: new Set() };
    if (playback.active) this.playbacks.add(playback);
    return {
      draw: (source, paint) => this.paint(target, source, paint, playback),
      dispose: () => {
        playback.active = false;
        playback.displayed = undefined;
        this.playbacks.delete(playback);
        for (const request of playback.requests) request.abort();
        playback.requests.clear();
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
    const previous = this.latest.get(target),
      request = new AbortController();
    this.latest.set(target, request);
    playback?.requests.add(request);
    try {
      // A leased atlas larger than the cache budget must not reload each frame.
      const displayed = playback?.displayed;
      // Admit the successor before releasing its predecessor, so an unchanged
      // source keeps its shared request even when animation asks again mid-load.
      const acquiring =
        displayed?.source === source
          ? Promise.resolve(displayed.image)
          : this.acquire(source, request.signal);
      previous?.abort();
      const image = await acquiring;
      if (active() && target.isConnected && this.latest.get(target) === request) {
        if (playback) playback.displayed = { source, image };
        paint(image);
      }
    } catch (error) {
      if (active() && !request.signal.aborted && this.latest.get(target) === request) throw error;
    } finally {
      playback?.requests.delete(request);
      if (this.latest.get(target) === request) this.latest.delete(target);
    }
  }

  private acquire(source: string, signal: AbortSignal) {
    const cached = this.ready.get(source);
    if (cached) {
      this.ready.delete(source);
      this.ready.set(source, cached);
      return Promise.resolve(cached);
    }
    let pending = this.pending.get(source);
    if (!pending) {
      const controller = new AbortController(),
        lifetime = AbortSignal.any([controller.signal, this.lifetime.signal]);
      const created: PendingImage = {
        controller,
        readers: 0,
        promise: this.decodes
          .run(async () => {
            lifetime.throwIfAborted();
            const load = this.load(source);
            let cancellationFailure: unknown;
            const cancel = () => {
              try {
                load.cancel();
              } catch (error) {
                cancellationFailure = error;
              }
            };
            lifetime.addEventListener('abort', cancel, { once: true });
            try {
              if (lifetime.aborted) cancel();
              const image = await readUntilAborted(load.promise, lifetime);
              lifetime.throwIfAborted();
              this.ready.set(source, image);
              this.readyBytes += image.naturalWidth * image.naturalHeight * 4;
              while (this.ready.size > 48 || this.readyBytes > 64 * 1024 * 1024) {
                const oldest = this.ready.keys().next().value!;
                const removed = this.ready.get(oldest)!;
                this.ready.delete(oldest);
                this.readyBytes -= removed.naturalWidth * removed.naturalHeight * 4;
              }
              return image;
            } catch (error) {
              cleanupAfterFailure(error, () => {
                if (cancellationFailure !== undefined) throw cancellationFailure;
              });
            } finally {
              lifetime.removeEventListener('abort', cancel);
            }
          }, lifetime)
          .finally(() => {
            if (this.pending.get(source) === created) this.pending.delete(source);
          }),
      };
      this.pending.set(source, created);
      pending = created;
    }
    const owned = pending;
    owned.readers++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener('abort', release);
      if (--owned.readers === 0 && this.pending.get(source) === owned) {
        this.pending.delete(source);
        owned.controller.abort();
      }
    };
    signal.addEventListener('abort', release, { once: true });
    if (signal.aborted) release();
    return readUntilAborted(owned.promise, signal).finally(release);
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
    this.pending.clear();
  }
}
