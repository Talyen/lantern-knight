import { html } from './dom';
import { itemArt, itemArtCrops, itemArtAssets } from './content/item-art';
import type { AssetRuntime } from './assets/loader';
import { verifiedBitmap } from './assets/bitmap';
import { readUntilAborted } from './assets/abort';

type ItemArtwork = ((id: string, className?: string) => HTMLElement) & {
  prepare(): Promise<void>;
};
const lifetimes = new WeakMap<AbortSignal, Map<AssetRuntime, ItemArtwork>>();

export function createItemArtwork(runtime: AssetRuntime, signal: AbortSignal): ItemArtwork {
  signal.throwIfAborted();
  let scope = lifetimes.get(signal);
  if (!scope) lifetimes.set(signal, (scope = new Map()));
  const existing = scope.get(runtime);
  if (existing) return existing;
  const drawings = new Map<string, Promise<string>>();
  const urls = new Set<string>();
  signal.addEventListener(
    'abort',
    () => {
      drawings.clear();
      scope.delete(runtime);
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    },
    { once: true },
  );
  function source(id: string) {
    signal.throwIfAborted();
    const asset = itemArt[id] ?? id;
    const crop = itemArtCrops[id];
    const key = asset + JSON.stringify(crop ?? []);
    let pending = drawings.get(key);
    if (!pending) {
      pending = (async () => {
        const manifest = await readUntilAborted(runtime.manifest(asset), signal);
        signal.throwIfAborted();
        const frame = manifest.frames[0]!;
        const page = manifest.pages.find((p) => p.id === frame.page)!;
        const file = runtime.catalog[asset]!;
        const delivered = page.delivery?.find(
          (image) =>
            image.encoding === 'png' && image.width === page.width && image.height === page.height,
        );
        const bitmap = await verifiedBitmap(
          delivered
            ? '/' + delivered.path
            : '/' + file.slice(0, file.lastIndexOf('/') + 1) + page.path,
          delivered ?? page,
          runtime.imageRequest,
          signal,
        );
        try {
          const canvas = document.createElement('canvas');
          const [frameX, frameY, frameWidth, frameHeight] = frame.rect;
          const x = frameX + Math.round((crop?.[0] ?? 0) * frameWidth);
          const y = frameY + Math.round((crop?.[1] ?? 0) * frameHeight);
          const width = Math.round((crop?.[2] ?? 1) * frameWidth);
          const height = Math.round((crop?.[3] ?? 1) * frameHeight);
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          // Runtime bitmaps are flipped for WebGL; restore authored orientation.
          ctx.translate(0, height);
          ctx.scale(1, -1);
          ctx.drawImage(bitmap, x, bitmap.height - y - height, width, height, 0, 0, width, height);
          const pixels = ctx.getImageData(0, 0, width, height).data;
          let left = width,
            right = 0,
            top = height,
            bottom = 0;
          for (let row = 0; row < height; row++)
            for (let col = 0; col < width; col++)
              if (pixels[(row * width + col) * 4 + 3]! > 12) {
                left = Math.min(left, col);
                right = Math.max(right, col);
                top = Math.min(top, row);
                bottom = Math.max(bottom, row);
              }
          const result = document.createElement('canvas');
          result.width = Math.max(1, right - left + 1);
          result.height = Math.max(1, bottom - top + 1);
          result
            .getContext('2d')!
            .drawImage(
              canvas,
              left,
              top,
              result.width,
              result.height,
              0,
              0,
              result.width,
              result.height,
            );
          const blob = await new Promise<Blob>((resolve, reject) =>
            result.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error('Item drawing unavailable'))),
              'image/png',
            ),
          );
          signal.throwIfAborted();
          const url = URL.createObjectURL(blob);
          urls.add(url);
          return url;
        } finally {
          bitmap.close();
        }
      })();
      drawings.set(key, pending);
      void pending.catch(() => {
        if (drawings.get(key) === pending) drawings.delete(key);
      });
    }
    return pending;
  }
  const artwork = (id: string, className = '') => {
    const wrapper = html`<span class="item-art ${className}" aria-hidden="true"></span>`;
    void source(id)
      .then((url) => {
        if (signal.aborted || !wrapper.isConnected) return;
        const image = document.createElement('img');
        image.alt = '';
        image.onload = () => {
          if (!signal.aborted) wrapper.dataset.ready = 'true';
        };
        image.src = url;
        wrapper.style.setProperty('--art-image', `url("${url}")`);
        wrapper.append(image);
      })
      .catch(() => {
        if (!signal.aborted) wrapper.dataset.ready = 'error';
      });
    return wrapper;
  };
  const prepared = Object.assign(artwork, {
    async prepare() {
      // Finish known drawings under startup cover. Request remaining sources
      // serially, avoiding another decode burst alongside the mounted UI.
      for (const id of [...Object.keys(itemArt), ...itemArtAssets]) {
        signal.throwIfAborted();
        await source(id).catch(() => signal.throwIfAborted());
      }
    },
  });
  scope.set(runtime, prepared);
  return prepared;
}
