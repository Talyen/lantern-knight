import test from 'node:test';
import assert from 'node:assert/strict';
import { BitmapTexture } from '../../src/presentation/bitmap-texture';
import { SurfaceRelief } from '../../src/presentation/surface-relief';
import { GamePresentation } from '../../src/presentation/game-scene';
import { verifiedBitmap } from '../../src/assets/bitmap';
import { mockGlobals } from '../fixtures/globals';

const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('animation flow and surface companions share repeated acquisitions and release each bitmap once', async (t) => {
  let fetches = 0,
    closed = 0,
    uploads = 0;
  mockGlobals(t, {
    fetch: async (url: string) => {
      fetches++;
      return url.endsWith('surfaces.json')
        ? new Response(
            JSON.stringify({
              recipe: 'hand-authored-stone-height-v1',
              entries: {
                apron: {
                  asset: 'ink-graveyard-materials',
                  frame: 'frame',
                  pageHash: hash,
                  file: 'surface.png',
                  hash,
                  width: 2,
                  height: 3,
                },
              },
            }),
          )
        : new Response('abc');
    },
    createImageBitmap: async () => ({
      width: 2,
      height: 3,
      close() {
        closed++;
      },
    }),
  });
  const presentation: GamePresentation = Object.create(GamePresentation.prototype);
  const flow = new BitmapTexture(
    (signal) => verifiedBitmap('/animation/flow.png', { hash, width: 2, height: 3 }, fetch, signal),
    () => {
      uploads++;
    },
  );
  Object.assign(presentation, {
    flow,
    registration: { animation: { sha256: hash, width: 2, height: 3 } },
    renderer: {
      initTexture() {
        uploads++;
      },
    },
  });
  await Promise.all([presentation.loadAnimationFlow(), presentation.loadAnimationFlow()]);
  const texture = presentation.animationFlow!.texture;
  await presentation.loadAnimationFlow();
  assert.equal(presentation.animationFlow!.texture, texture);
  assert.equal(fetches, 1);
  assert.equal(uploads, 1);
  flow.dispose();
  flow.dispose();
  assert.equal(closed, 1);

  const surface = new SurfaceRelief();
  const packs = new Map([
    [
      'ink-graveyard-materials',
      { manifest: { frames: [{ id: 'frame', page: 'page' }], pages: [{ id: 'page', hash }] } },
    ],
  ]) as never;
  await Promise.all([surface.load(packs), surface.load(packs)]);
  await surface.load(packs);
  assert.equal(fetches, 3, 'One metadata request and one bitmap request for the surface');
  surface.dispose();
  surface.dispose();
  assert.equal(closed, 2);
});

test('companion failure retries, disposal settles waiters and late decodes release without upload', async () => {
  let attempts = 0,
    closed = 0,
    configured = 0;
  const started = Promise.withResolvers<void>(),
    late = Promise.withResolvers<ImageBitmap>();
  const companion = new BitmapTexture(
    async () => {
      if (++attempts === 1) throw new Error('transport');
      started.resolve();
      return late.promise;
    },
    () => {
      configured++;
    },
  );
  await assert.rejects(companion.load(), /transport/);
  const pending = companion.load();
  const rejected = assert.rejects(pending, /aborted/);
  await started.promise;
  companion.dispose();
  await rejected;
  await assert.rejects(companion.load(), /disposed/);
  late.resolve({
    width: 1,
    height: 1,
    close() {
      closed++;
    },
  } as ImageBitmap);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  assert.equal(configured, 0);
  assert.equal(companion.value, undefined);
});

test('companion upload failure releases both texture and decoded image before retry', async () => {
  let closed = 0,
    disposals = 0,
    attempts = 0;
  const companion = new BitmapTexture(
    async () =>
      ({
        close() {
          closed++;
        },
      }) as ImageBitmap,
    (texture) => {
      texture.addEventListener('dispose', () => {
        disposals++;
      });
      if (++attempts === 1) throw new Error('GPU upload');
    },
  );
  await assert.rejects(companion.load(), /GPU upload/);
  assert.equal(closed, 1);
  assert.equal(disposals, 1);
  await companion.load();
  companion.dispose();
  assert.equal(closed, 2);
  assert.equal(disposals, 2);
});
