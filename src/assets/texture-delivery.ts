import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { Texture, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter } from 'three';
import type { Manifest } from './schema';
import { sha256, verifiedBitmap } from './bitmap';
import { DecodeQueue } from './decode-queue';

export type ImageQuality = 'source' | 'delivery' | 'lossless';

type Variant = NonNullable<Manifest['pages'][number]['delivery']>[number];
export type ImageRequest = {
  url: string;
  hash: string;
  width: number;
  height: number;
  mipmaps?: boolean;
  encoding?: Variant['encoding'];
  gpuBytes?: number;
  sourceHash?: string;
  bytes?: number;
};
export type SourcePage = ImageRequest & { delivery?: readonly Variant[] };
export function selectDelivery(
  page: SourcePage,
  targetPixels: number,
  maxTextureSize: number,
  compressed: boolean,
  quality: ImageQuality,
  requireBlockAlignment = true,
): ImageRequest {
  if (quality === 'source' || !page.delivery?.length) {
    if (Math.max(page.width, page.height) > maxTextureSize)
      throw new Error(
        'The original image exceeds this GPU’s texture size. Use delivery images on this device.',
      );
    const lossless = page.delivery?.find(
      (v) => v.encoding === 'png' && v.width === page.width && v.height === page.height,
    );
    return lossless
      ? {
          ...lossless,
          mipmaps: page.mipmaps ?? false,
          gpuBytes: Math.ceil(page.width * page.height * 4 * (page.mipmaps ? 4 / 3 : 1)),
          url: '/' + lossless.path,
          sourceHash: page.hash,
        }
      : page;
  }
  const available = page.delivery.filter(
    (v) =>
      Math.max(v.width, v.height) <= maxTextureSize &&
      (v.encoding === 'png' ||
        (quality !== 'lossless' &&
          compressed &&
          (!requireBlockAlignment || (v.width % 4 === 0 && v.height % 4 === 0)))),
  );
  if (!available.length)
    throw new Error('No prepared image fits this GPU; the source image remains available.');
  const required = Math.min(Math.max(page.width, page.height), targetPixels);
  const sizes = [...new Set(available.map((v) => Math.max(v.width, v.height)))].sort(
    (a, b) => a - b,
  );
  const selected = sizes.find((n) => n >= required) ?? sizes.at(-1)!;
  const choices = available.filter((v) => Math.max(v.width, v.height) === selected);
  const v =
    choices.find((v) => v.encoding === 'ktx2-uastc') ?? choices.find((v) => v.encoding === 'png')!;
  return { ...v, url: '/' + v.path, sourceHash: page.hash };
}
export class TextureDelivery {
  private readonly decodes = new DecodeQueue();
  private loader = new KTX2Loader().setTranscoderPath('/decoders/').setWorkerLimit(1);
  private abort = new AbortController();
  private pending = new Set<(error: Error) => void>();
  private closed = false;
  private compressed: boolean;
  private maxSize: number;
  constructor(
    canvas: HTMLCanvasElement,
    private quality: ImageQuality = 'delivery',
    private request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL 2 is unavailable');
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const bptc = !!gl.getExtension('EXT_texture_compression_bptc');
    const astc = !!gl.getExtension('WEBGL_compressed_texture_astc');
    // Follow the Basis UASTC target priority: ASTC, then BC7.
    // Keep the lossless image fallback for other devices.
    this.loader.workerConfig = {
      bptcSupported: bptc,
      astcSupported: astc,
      astcHDRSupported: false,
      etc1Supported: false,
      etc2Supported: false,
      dxtSupported: false,
      pvrtcSupported: false,
    };
    // The supplied Basis worker generates JS invokers. Strict pages permit WASM
    // but forbid that glue; choose the prepared lossless image instead of hanging
    // a decode inside a worker rejected by the page's inherited policy.
    const policy = canvas.ownerDocument.querySelector<HTMLMetaElement>(
      'meta[http-equiv="Content-Security-Policy"]',
    )?.content;
    this.compressed = (bptc || astc) && (!policy || policy.includes("'unsafe-eval'"));
  }
  choose(page: SourcePage) {
    // Screen dimensions alone do not describe projected image coverage when
    // the camera pans or zooms. Keep native detail; mipmaps handle minification.
    return selectDelivery(
      page,
      Infinity,
      this.maxSize,
      this.compressed,
      this.quality,
      !this.loader.workerConfig.astcSupported && this.loader.workerConfig.bptcSupported,
    );
  }
  decode(page: ImageRequest): Promise<Texture> {
    return this.decodes.run(() => this.decodePage(page));
  }
  private async decodePage(page: ImageRequest): Promise<Texture> {
    if (this.closed) throw new Error('Image loader disposed');
    let texture: Texture;
    if (page.encoding === 'ktx2-uastc') {
      const response = await this.request(page.url, { signal: this.abort.signal });
      if (!response.ok) throw new Error(`${page.url}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if ((await sha256(bytes)) !== page.hash) throw new Error(`${page.url}: hash mismatch`);
      texture = await new Promise<Texture>((resolve, reject) => {
        const fail = (e: Error) => {
          this.pending.delete(fail);
          reject(e);
        };
        if (this.closed) {
          fail(new Error('Image loader disposed'));
          return;
        }
        this.pending.add(fail);
        this.loader.parse(
          bytes,
          (value) => {
            this.pending.delete(fail);
            if (this.closed) {
              value.dispose();
              reject(new Error('Image loader disposed'));
            } else resolve(value);
          },
          (error) => fail(error instanceof Error ? error : new Error(String(error))),
        );
      });
      const dimensions = imageDimensions(texture.image);
      if (dimensions.width !== page.width || dimensions.height !== page.height) {
        texture.dispose();
        throw new Error('Compressed image dimensions differ');
      }
      texture.generateMipmaps = false;
    } else {
      const bitmap = await verifiedBitmap(page.url, page, (url, init) =>
        this.request(url, { ...init, signal: this.abort.signal }),
      );
      if (this.closed) {
        bitmap.close();
        throw new Error('Image loader disposed');
      }
      texture = new Texture(bitmap);
      texture.generateMipmaps = page.mipmaps === true;
    }
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = page.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
    texture.magFilter = LinearFilter;
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    texture.userData.delivery = {
      encoding: page.encoding ?? 'png',
      width: page.width,
      height: page.height,
      bytes: page.bytes ?? 0,
      gpuBytes:
        page.gpuBytes ?? Math.ceil(page.width * page.height * 4 * (page.mipmaps ? 4 / 3 : 1)),
      sourceHash: page.sourceHash ?? page.hash,
    };
    texture.needsUpdate = true;
    return texture;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.decodes.dispose();
    this.abort.abort();
    for (const reject of this.pending) reject(new Error('Image loader disposed'));
    this.pending.clear();
    this.loader.dispose();
    void this.loader.transcoderPending?.then(
      () => this.loader.dispose(),
      () => {},
    );
  }
}

export function imageDimensions(image: unknown) {
  if (
    !image ||
    typeof image !== 'object' ||
    !('width' in image) ||
    !('height' in image) ||
    typeof image.width !== 'number' ||
    typeof image.height !== 'number'
  )
    throw new Error('Decoded image has no dimensions');
  return { width: image.width, height: image.height };
}
