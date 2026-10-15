import test from 'node:test';
import assert from 'node:assert/strict';
import { BitmapTexture } from '../../src/presentation/bitmap-texture';
import { GamePresentation } from '../../src/presentation/game-scene';
import { NormalLibrary } from '../../src/presentation/normal-library';
import { verifiedBitmap } from '../../src/assets/bitmap';
import { mockGlobals } from '../fixtures/globals';

const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('failed normal batches retire staging and admit recovery while a native decode remains pending', async (t) => {
  const decoding = Promise.withResolvers<void>(),
    late = Promise.withResolvers<ImageBitmap>(),
    closed: string[] = [];
  const bitmap = (id: string) =>
    ({ width: 2, height: 3, close: () => closed.push(id) }) as ImageBitmap;
  let decodes = 0;
  mockGlobals(t, {
    createImageBitmap: async () => {
      if (++decodes === 2) {
        decoding.resolve();
        return late.promise;
      }
      return bitmap(String(decodes));
    },
  });
  const library = new NormalLibrary(async (url) => {
    const file = url instanceof Request ? url.url : url.toString();
    if (file.endsWith('manifest.json'))
      return Response.json({
        recipe: 'alpha-volume-v1',
        entries: Object.fromEntries(
          ['current', 'late', 'missing', 'recovery'].map((id) => [
            id + ':pose',
            { file: id + '.png', hash, width: 2, height: 3 },
          ]),
        ),
      });
    if (file.endsWith('missing.png')) {
      await decoding.promise;
      return new Response('', { status: 503 });
    }
    return new Response('abc');
  });
  t.after(() => {
    library.dispose();
    late.resolve(bitmap('late'));
  });
  await library.load(['current']);
  const current = library.textures.get('current:pose');
  let failed = false;
  const failure = assert.rejects(library.load(['late', 'missing']), /HTTP 503/).then(() => {
    failed = true;
  });
  await decoding.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(failed, true, 'One failed companion must retire its unfinished peers');
  await failure;
  assert.equal(library.textures.get('current:pose'), current);
  await library.load(['recovery']);
  const recovery = library.textures.get('recovery:pose');
  late.resolve(bitmap('late'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(library.textures.get('recovery:pose'), recovery);
  assert.deepEqual(closed, ['1', 'late']);
});

test('cancelled normal selections release staging and unblock recovery before native decode settles', async (t) => {
  const decoding = Promise.withResolvers<void>(),
    late = Promise.withResolvers<ImageBitmap>(),
    closed: number[] = [];
  let decodes = 0;
  const bitmap = (id: number) =>
    ({ width: 2, height: 3, close: () => closed.push(id) }) as unknown as ImageBitmap;
  mockGlobals(t, {
    fetch: async (url: string) =>
      url.endsWith('manifest.json')
        ? new Response(
            JSON.stringify({
              recipe: 'alpha-volume-v1',
              entries: Object.fromEntries(
                ['current', 'staged', 'late', 'recovery'].map((id) => [
                  id + ':pose',
                  { file: id + '.png', hash, width: 2, height: 3 },
                ]),
              ),
            }),
          )
        : new Response('abc'),
    createImageBitmap: async () => {
      const id = ++decodes;
      if (id === 3) {
        decoding.resolve();
        return late.promise;
      }
      return bitmap(id);
    },
  });
  const library = new NormalLibrary(),
    abort = new AbortController();
  t.after(() => {
    abort.abort();
    late.resolve(bitmap(3));
    library.dispose();
  });
  await library.load(['current']);
  const current = library.textures.get('current:pose');
  let settled = false;
  const pending = library.load(['staged', 'late'], abort.signal);
  const rejected = assert.rejects(pending, /obsolete/).then(() => {
    settled = true;
  });
  await decoding.promise;
  const queuedAbort = new AbortController(),
    queued = assert.rejects(library.load(['current'], queuedAbort.signal), /queued obsolete/);
  queuedAbort.abort(new Error('queued obsolete'));
  await queued;
  abort.abort(new Error('obsolete'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, true, 'Cancellation must not wait for a native decoder');
  await rejected;
  assert.deepEqual(closed, [2], 'Release completed staging without retiring the accepted room');
  assert.equal(library.textures.get('current:pose'), current);
  await library.load(['recovery']);
  const recovery = library.textures.get('recovery:pose');
  assert.ok(recovery);
  assert.equal(library.bytes, 24);
  late.resolve(bitmap(3));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(closed, [2, 1, 3]);
  assert.equal(library.textures.get('recovery:pose'), recovery);
  assert.equal(library.textures.size, 1);
});

test('animation flow shares repeated acquisitions and releases its bitmap once', async (t) => {
  let fetches = 0,
    closed = 0,
    uploads = 0;
  mockGlobals(t, {
    fetch: async (url: string) => {
      fetches++;
      assert.equal(url, '/animation/flow.png');
      return new Response('abc');
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
