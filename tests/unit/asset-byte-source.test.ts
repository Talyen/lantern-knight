import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeBundles } from '../../tools/build-runtime-delivery';
import { AssetByteSource } from '../../src/assets/byte-source';
import { DecodeQueue } from '../../src/assets/decode-queue';

test('bundled prepared images retain exact bytes, deduplicate transport and isolate read cancellation', async () => {
  const images = new Map([
    ['lighting/first.png', Buffer.from('first PNG')],
    ['lighting/second.png', Buffer.from('second PNG')],
  ]);
  const built = await runtimeBundles(new Map([['hero', new Set(images.keys())]]), async (file) =>
    images.get(file)!,
  );
  let requests = 0;
  const transport = Promise.withResolvers<Response>();
  const source = new AssetByteSource(built.bundles, async () => {
    requests++;
    return transport.promise;
  });
  const cancelled = new AbortController();
  const first = source.request('/lighting/first.png', { signal: cancelled.signal });
  const rejected = assert.rejects(first, /cancelled/);
  const second = source.request('/lighting/second.png');
  cancelled.abort(new Error('cancelled'));
  transport.resolve(new Response(new Uint8Array(Object.values(built.binary)[0]!)));
  await rejected;
  assert.deepEqual(
    Buffer.from(await (await second).arrayBuffer()),
    images.get('lighting/second.png'),
  );
  assert.deepEqual(
    Buffer.from(await (await source.request('/lighting/first.png')).arrayBuffer()),
    images.get('lighting/first.png'),
  );
  assert.equal(requests, 1);
  source.dispose();
  await assert.rejects(source.request('/lighting/first.png'), /aborted/);
});

test('corrupt bundles and byte ranges fail before any decoder receives bytes; disposal discards late transport', async () => {
  const built = await runtimeBundles(new Map([['hero', new Set(['lighting/a.png'])]]), async () =>
    Buffer.from('a'),
  );
  const bundle = built.bundles[0]!;
  assert.throws(
    () =>
      new AssetByteSource([
        { ...bundle, files: { 'lighting/a.png': { offset: 1, bytes: 1, hash: bundle.hash } } },
      ]),
    /byte range/,
  );
  assert.throws(() => new AssetByteSource([bundle, bundle]), /Duplicate/);
  const corrupt = new AssetByteSource(built.bundles, async () => new Response('b'));
  await assert.rejects(corrupt.request('/lighting/a.png'), /hash or size differs/);
  corrupt.dispose();
  const pending = Promise.withResolvers<Response>();
  const late = new AssetByteSource(built.bundles, async () => pending.promise);
  const read = late.request('/lighting/a.png'),
    rejected = assert.rejects(read, /aborted/);
  late.dispose();
  pending.resolve(new Response('a'));
  await rejected;
});

test('decode admission bounds work and shutdown settles queued work without starting it', async () => {
  const queue = new DecodeQueue(1),
    waiting = Promise.withResolvers<number>();
  let started = 0;
  const first = queue.run(() => {
    started++;
    return waiting.promise;
  });
  const next = queue.run(async () => {
    started++;
    return 2;
  });
  const rejected = assert.rejects(next, /disposed/);
  await Promise.resolve();
  assert.equal(started, 1);
  queue.dispose();
  waiting.resolve(1);
  assert.equal(await first, 1);
  await rejected;
  assert.equal(started, 1);
});

test('cancelled queued decodes settle without waiting for active work or starting downloads', async () => {
  const queue = new DecodeQueue(1),
    active = Promise.withResolvers<number>(),
    controller = new AbortController();
  const first = queue.run(() => active.promise);
  let obsoleteStarts = 0;
  const obsolete = queue.run(async () => {
      obsoleteStarts++;
      return 2;
    }, controller.signal),
    rejected = assert.rejects(obsolete, /obsolete/),
    next = queue.run(async () => 3);
  controller.abort(new Error('obsolete'));
  await rejected;
  active.resolve(1);
  assert.equal(await first, 1);
  assert.equal(await next, 3);
  assert.equal(obsoleteStarts, 0);
  queue.dispose();
});
