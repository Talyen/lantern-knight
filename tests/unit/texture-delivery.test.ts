import { manifestFixture } from '../fixtures/manifest';
import { parseManifest } from '../../src/assets/schema';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDelivery,
  TextureDelivery,
  type SourcePage,
} from '../../src/assets/texture-delivery';
import { useGpuCompression } from '../../tools/assets/image-delivery';

test('delivery selects adequate full-composition variants, preserves source quality and respects GPU formats', () => {
  const variant = (width: number, height: number, encoding: 'png' | 'ktx2-uastc') => ({
    width,
    height,
    encoding,
    path: `${width}.${encoding}`,
    hash: 'a'.repeat(64),
    bytes: 10,
    gpuBytes: 20,
    mipmaps: true,
  });
  const page: SourcePage = {
    url: '/master.png',
    hash: 'b'.repeat(64),
    width: 6144,
    height: 4096,
    delivery: [
      variant(2040, 1360, 'png'),
      variant(2040, 1360, 'ktx2-uastc'),
      variant(4092, 2728, 'png'),
      variant(4092, 2728, 'ktx2-uastc'),
      variant(6144, 4096, 'png'),
      variant(6144, 4096, 'ktx2-uastc'),
    ],
  };
  assert.equal(selectDelivery(page, 2500, 8192, true, 'delivery').width, 4092);
  assert.equal(selectDelivery(page, 2500, 8192, false, 'delivery').encoding, 'png');
  // Editor picking needs drawable PNGs, with native detail when supported and
  // a complete smaller composition on a GPU limited to 4096 pixels.
  const editorNative = selectDelivery(page, Infinity, 8192, true, 'lossless');
  assert.equal(editorNative.width, 6144);
  assert.equal(editorNative.encoding, 'png');
  const editorLimited = selectDelivery(page, Infinity, 4096, true, 'lossless');
  assert.equal(editorLimited.width, 4092);
  assert.equal(editorLimited.encoding, 'png');

  const original = selectDelivery(page, 1000, 8192, true, 'source');
  assert.equal(original.width, 6144);
  assert.equal(original.encoding, 'png');
  assert.equal(original.mipmaps, false);
  assert.throws(() => selectDelivery(page, 1000, 4096, true, 'source'), /original image exceeds/);
  const odd: SourcePage = {
    ...page,
    width: 2051,
    height: 1367,
    delivery: [variant(2051, 1367, 'png'), variant(2051, 1367, 'ktx2-uastc')],
  };
  assert.equal(selectDelivery(odd, 4000, 8192, true, 'delivery').encoding, 'png');
  assert.equal(selectDelivery(odd, 4000, 8192, true, 'delivery', false).encoding, 'ktx2-uastc');
});

test('alpha-sensitive artwork keeps lossless delivery and GPU formats respect block dimensions', () => {
  assert.equal(useGpuCompression(true, 640, 640), false);
  assert.equal(useGpuCompression(false, 6144, 4096), true);
  assert.equal(useGpuCompression(false, 1254, 1254), false);
  assert.equal(useGpuCompression(false, 1672, 941), false);
  assert.equal(useGpuCompression(false, 2, 2), true);
});

test('strict browser policy uses lossless artwork without starting the eval-based Basis worker', () => {
  const page: SourcePage = {
    url: '/master.png',
    hash: 'a'.repeat(64),
    width: 512,
    height: 512,
    delivery: (['png', 'ktx2-uastc'] as const).map((encoding) => ({
      encoding,
      path: 'art.' + encoding,
      hash: 'a'.repeat(64),
      width: 512,
      height: 512,
      bytes: 10,
      gpuBytes: 20,
      mipmaps: false,
    })),
  };
  const gl = { MAX_TEXTURE_SIZE: 3379, getParameter: () => 8192, getExtension: () => ({}) };
  const canvas = {
    getContext: () => gl,
    ownerDocument: { querySelector: () => ({ content: "script-src 'self' 'wasm-unsafe-eval'" }) },
  } as unknown as HTMLCanvasElement;
  const delivery = new TextureDelivery(canvas);
  try {
    assert.equal(delivery.choose(page).encoding, 'png');
    assert.equal(delivery.choose(page).width, 512);
  } finally {
    delivery.dispose();
  }
});

test('wide atlas previews allow normal integer rounding without rejecting the asset', () => {
  const manifest = manifestFixture('wide-flame');
  const page = manifest.pages[0]!;
  page.width = 6144;
  page.height = 512;
  page.rgbaBytes = 6144 * 512 * 4;
  page.preview = {
    path: 'preview.png',
    hash: 'c'.repeat(64),
    width: 512,
    height: 43,
    bytes: 1,
    gpuBytes: 512 * 43 * 4,
    encoding: 'png',
    mipmaps: false,
  };
  parseManifest(manifest);
});
