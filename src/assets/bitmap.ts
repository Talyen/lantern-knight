import { startupStage } from './startup-timing';
import { SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter, type Texture } from 'three';
export async function sha256(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function fetchVerifiedBytes(
  url: string,
  hash: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const response = await request(url, { signal });
  signal?.throwIfAborted();
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  if ((await sha256(bytes)) !== hash) throw new Error(`${url}: hash mismatch`);
  signal?.throwIfAborted();
  return bytes;
}

// All runtime textures preserve authored orientation, straight alpha and color data.
export function configureTexture(texture: Texture, mipmaps: boolean) {
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.magFilter = LinearFilter;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
}

// All runtime PNGs preserve authored orientation, straight alpha and color data.
export async function verifiedBitmap(
  url: string,
  expected: { hash: string; width: number; height: number },
  request: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const bytes = await fetchVerifiedBytes(url, expected.hash, request, signal);
  const bitmap = await startupStage('image-decode', () =>
    createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    }),
  );
  if (signal?.aborted) {
    bitmap.close();
    signal.throwIfAborted();
  }
  if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
    bitmap.close();
    throw new Error(`${url}: image dimensions differ`);
  }
  return bitmap;
}
