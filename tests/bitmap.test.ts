import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedBitmap } from '../src/assets/bitmap';

test('verified PNG loading rejects corrupt bytes before decode and closes wrongly sized bitmaps', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let decoded = 0,
    closed = 0,
    width = 2;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async (_blob: Blob, options: ImageBitmapOptions) => {
      decoded++;
      assert.deepEqual(options, {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      return { width, height: 3, close: () => closed++ };
    },
  });
  const expected = {
    hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    width: 2,
    height: 3,
  };
  const response =
    (body: string, status = 200) =>
    async () =>
      new Response(body, { status });
  try {
    await assert.rejects(
      verifiedBitmap('/page.png', expected, response('missing', 404)),
      /HTTP 404/,
    );
    await assert.rejects(
      verifiedBitmap('/page.png', expected, response('corrupt')),
      /hash mismatch/,
    );
    assert.equal(decoded, 0);
    width = 4;
    await assert.rejects(
      verifiedBitmap('/page.png', expected, response('abc')),
      /dimensions differ/,
    );
    assert.equal(closed, 1);
    width = 2;
    const bitmap = await verifiedBitmap('/page.png', expected, response('abc'));
    assert.equal(bitmap.width, 2);
    assert.equal(closed, 1, 'a successful acquisition leaves bitmap lifetime to its owner');
    bitmap.close();
    assert.equal(closed, 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
});
