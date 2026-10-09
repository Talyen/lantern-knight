import { validateLightingBindings } from '../../tools/lighting-bindings';
import { manifestFixture } from '../fixtures/manifest';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalPixels } from '../../src/presentation/lighting-profiles';

import { GroundMist } from '../../src/presentation/ground-mist';
import { heightAt } from '../../src/content/world';
import { content } from '../fixtures/content';

test('mist ribbons follow the raised terrain rather than intersecting its steps', () => {
  const mist = new GroundMist(),
    area = content.area('upper-landing');
  mist.setArea(area);
  for (const object of mist.group.children) {
    const mesh = object as import('three').Mesh,
      vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++)
      assert.ok(
        Math.abs(
          vertices.getY(i) -
            heightAt(area, mesh.position.x + vertices.getX(i), mesh.position.z + vertices.getZ(i)) -
            0.14,
        ) < 1e-6,
      );
  }
  mist.dispose();
  assert.equal(mist.group.parent, null);
});
test('alpha-derived normals point outward with an unchanged coverage channel', () => {
  const alpha = new Uint8Array([
      0, 0, 0, 0, 0, 0, 40, 100, 40, 0, 0, 100, 255, 100, 0, 0, 40, 100, 40, 0, 0, 0, 0, 0, 0,
    ]),
    normals = normalPixels(alpha, 5, 5, 2);
  const pixel = (x: number, y: number) => normals.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4);
  assert.ok(pixel(1, 2)[0]! < 128);
  assert.ok(pixel(3, 2)[0]! > 128);
  assert.ok(pixel(2, 1)[1]! > 128);
  assert.ok(pixel(2, 3)[1]! < 128);
  assert.deepEqual([...pixel(2, 2)], [128, 128, 255, 255]);
  for (let i = 0; i < alpha.length; i++) assert.equal(normals[i * 4 + 3], alpha[i]);
  assert.throws(() => normalPixels(alpha, 4, 5), /dimensions/);
  const manifest = manifestFixture(),
    frame = manifest.frames[0]!;
  const entry = {
    file: 'normal.png',
    hash: 'c'.repeat(64),
    sourceHash: manifest.pages[0]!.hash,
    rect: frame.rect,
    trim: frame.trim,
  };
  const library = {
    recipe: 'alpha-volume-v1',
    entries: { 'ink-hero-current:sample-frame': entry },
  };
  const manifests = new Map([['ink-hero-current', manifest]]);
  validateLightingBindings(library, manifests);
  assert.throws(
    () => validateLightingBindings({ ...library, entries: {} }, manifests),
    /Missing lighting/,
  );
  assert.throws(
    () =>
      validateLightingBindings(
        {
          ...library,
          entries: { 'ink-hero-current:sample-frame': { ...entry, sourceHash: 'd'.repeat(64) } },
        },
        manifests,
      ),
    /Stale lighting/,
  );
  assert.throws(
    () =>
      validateLightingBindings(
        {
          ...library,
          entries: { 'ink-hero-current:sample-frame': { ...entry, rect: [1, 1, 1, 1] } },
        },
        manifests,
      ),
    /crop differs/,
  );
  assert.throws(
    () =>
      validateLightingBindings(
        { ...library, entries: { ...library.entries, 'unknown:frame': entry } },
        manifests,
      ),
    /Unknown lighting/,
  );
});

test('authoring lighting loads only placed library assets and releases companions after removal', async () => {
  const { NormalLibrary } = await import('../../src/presentation/illustrated-lighting');
  const { createHash } = await import('node:crypto'),
    bytes = Buffer.from('verified companion'),
    hash = createHash('sha256').update(bytes).digest('hex');
  const priorFetch = globalThis.fetch,
    priorBitmap = globalThis.createImageBitmap;
  const requests: string[] = [];
  let closed = 0;
  const entry = (file: string) => ({
    file,
    hash,
    width: 2,
    height: 2,
    sourceHash: 'a'.repeat(64),
    rect: [0, 0, 2, 2],
    trim: [0, 0, 2, 2],
  });
  globalThis.fetch = (async (url) => {
    requests.push(url instanceof Request ? url.url : url.toString());
    return (url instanceof Request ? url.url : url.toString()).endsWith('manifest.json')
      ? new Response(
          JSON.stringify({
            recipe: 'alpha-volume-v1',
            entries: {
              'ink-hero-current:pose': entry('base.png'),
              'library-a:pose': entry('a.png'),
              'library-b:pose': entry('b.png'),
            },
          }),
        )
      : new Response(bytes);
  }) as typeof fetch;
  globalThis.createImageBitmap = (async () =>
    ({ width: 2, height: 2, close: () => closed++ }) as ImageBitmap) as typeof createImageBitmap;
  const library = new NormalLibrary();
  try {
    await library.load(['library-a']);
    assert.equal(requests.includes('/lighting/b.png'), false);
    assert.equal(library.bytes, 32);
    await library.load(['library-a']);
    assert.equal(requests.filter((u) => u === '/lighting/a.png').length, 1);
    await library.load(['library-b']);
    assert.equal(closed, 1);
    assert.equal(library.bytes, 32);
    assert.equal(library.textures.has('library-a:pose'), false);
  } finally {
    library.dispose();
    globalThis.fetch = priorFetch;
    globalThis.createImageBitmap = priorBitmap;
  }
  assert.equal(closed, 3);
});
