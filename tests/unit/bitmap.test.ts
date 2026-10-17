import { mockGlobals } from '../fixtures/globals';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifiedBitmap } from '../../src/assets/bitmap';

test('verified PNG loading rejects corrupt bytes before decode and closes wrongly sized bitmaps', async (t) => {
  let decoded = 0,
    closed = 0,
    width = 2;
  mockGlobals(t, {
    createImageBitmap: async (_blob: Blob, options: ImageBitmapOptions) => {
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

  await assert.rejects(verifiedBitmap('/page.png', expected, response('missing', 404)), /HTTP 404/);
  await assert.rejects(verifiedBitmap('/page.png', expected, response('corrupt')), /hash mismatch/);
  assert.equal(decoded, 0);
  width = 4;
  await assert.rejects(verifiedBitmap('/page.png', expected, response('abc')), /dimensions differ/);
  assert.equal(closed, 1);
  width = 2;
  const bitmap = await verifiedBitmap('/page.png', expected, response('abc'));
  assert.equal(bitmap.width, 2);
  assert.equal(closed, 1, 'a successful acquisition leaves bitmap lifetime to its owner');
  bitmap.close();
  assert.equal(closed, 2);
});

test('cancelled PNG stages stop before body reads, hashing or upload and close late bitmaps', async (t) => {
  const expected = {
    hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    width: 2,
    height: 3,
  };
  for (const phase of ['response', 'body', 'decode']) {
    const controller = new AbortController();
    let reads = 0,
      decodes = 0,
      closes = 0;
    mockGlobals(t, {
      createImageBitmap: async () => {
        decodes++;
        controller.abort(new Error('obsolete decode'));
        return { width: 2, height: 3, close: () => closes++ };
      },
    });
    const request = async () => {
      if (phase === 'response') controller.abort(new Error('obsolete response'));
      return Object.assign(new Response('abc'), {
        arrayBuffer: async () => {
          reads++;
          if (phase === 'body') controller.abort(new Error('obsolete body'));
          return new TextEncoder().encode(phase === 'body' ? 'obsolete bytes' : 'abc').buffer;
        },
      });
    };
    await assert.rejects(
      verifiedBitmap('/page.png', expected, request, controller.signal),
      /obsolete/,
    );
    assert.equal(reads, phase === 'response' ? 0 : 1);
    assert.equal(decodes, phase === 'decode' ? 1 : 0);
    assert.equal(closes, decodes);
  }
});
