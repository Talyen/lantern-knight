import { ResourceCache } from '../assets/resource-cache';
import { DecodeQueue } from '../assets/decode-queue';
type Playback = {
  active: boolean;
  requests: Set<AbortController>;
  displayed?: { source: string; image: HTMLImageElement };
};
export type PreviewPlayback = {
  draw(source: string, paint: (image: HTMLImageElement) => void): Promise<void>;
  dispose(): void;
};

function loadImage(source: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const clear = () => {
      image.onload = image.onerror = null;
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      clear();
      image.removeAttribute('src');
      reject(signal.reason);
    };
    image.onload = () => {
      clear();
      resolve(image);
    };
    image.onerror = () => {
      clear();
      reject(new Error(`Preview image unavailable: ${source}`));
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    else image.src = source;
  });
}

// All editor thumbnails and animated previews share one decode/cache lifetime.
// A canvas accepts only its latest request, even when pages finish out of order.
export class PreviewImages {
  private readonly cache = new ResourceCache<HTMLImageElement>(
    (image) => image.naturalWidth * image.naturalHeight * 4,
    64 * 1024 ** 2,
    48,
  );
  private readonly decodes = new DecodeQueue(6);
  private latest = new WeakMap<HTMLCanvasElement, AbortController>();
  private readonly playbacks = new Set<Playback>();
  private readonly lifetime = new AbortController();
  private get closed() {
    return this.lifetime.signal.aborted;
  }
  constructor(private readonly load = loadImage) {}

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

  private async acquire(source: string, signal: AbortSignal) {
    const held = await this.cache.acquire(
      source,
      (lifetime) => this.decodes.run(() => this.load(source, lifetime), lifetime),
      signal,
    );
    held.release();
    return held.value;
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
    this.cache.dispose();
    this.decodes.dispose();
  }
}
