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
  const cachedCancellation = new AbortController(),
    cachedRead = source.request('/lighting/first.png', { signal: cachedCancellation.signal });
  cachedCancellation.abort(new Error('cached read cancelled'));
  await assert.rejects(cachedRead, /cached read cancelled/);
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

test('the last cancelled bundle reader retires stalled transport so a successor can recover', async (t) => {
  for (const outcome of ['success', 'failure'])
    await t.test('late ' + outcome, async () => {
      const built = await runtimeBundles(
        new Map([['hero', new Set(['lighting/a.png'])]]),
        async () => Buffer.from('a'),
      );
      const downloads: {
          signal: AbortSignal;
          response: ReturnType<typeof Promise.withResolvers<Response>>;
        }[] = [],
        source = new AssetByteSource(built.bundles, async (_url, init) => {
          const response = Promise.withResolvers<Response>();
          downloads.push({ signal: init!.signal!, response });
          if (downloads.length === 1)
            init!.signal!.addEventListener(
              'abort',
              () => {
                next = source.request('/lighting/a.png');
              },
              { once: true },
            );
          return response.promise; // Deliberately ignores abort to exercise late completion.
        }),
        first = new AbortController(),
        last = new AbortController(),
        firstRead = source.request('/lighting/a.png', { signal: first.signal }),
        lastRead = source.request('/lighting/a.png', { signal: last.signal }),
        rejected = Promise.all([
          assert.rejects(firstRead, /obsolete/),
          assert.rejects(lastRead, /obsolete/),
        ]);
      let next: Promise<Response> | undefined, shared: Promise<Response> | undefined;
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(downloads.length, 1);
        first.abort(new Error('obsolete first reader'));
        assert.equal(
          downloads[0]!.signal.aborted,
          false,
          'A surviving reader retains the download',
        );
        last.abort(new Error('obsolete last reader'));
        await rejected;
        assert.equal(
          downloads[0]!.signal.aborted,
          true,
          'No reader remains to own the stalled download',
        );

        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(downloads.length, 2, 'Reentrant recovery must start fresh transport');
        let bodyReads = 0;
        if (outcome === 'failure')
          downloads[0]!.response.reject(new Error('late obsolete transport failure'));
        else
          downloads[0]!.response.resolve(
            Object.assign(new Response('a'), {
              arrayBuffer: async () => {
                bodyReads++;
                return new Uint8Array([97]).buffer;
              },
            }),
          );
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(bodyReads, 0, 'Abandoned transport must not consume or cache a late response');
        shared = source.request('/lighting/a.png');
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(downloads.length, 2, 'Late completion cannot unregister a successor download');
        downloads[1]!.response.resolve(new Response('a'));
        assert.ok(next);
        for (const response of await Promise.all([next, shared]))
          assert.equal(await response.text(), 'a');
      } finally {
        source.dispose();
        for (const download of downloads) download.response.reject(new Error('test cleanup'));
        await Promise.allSettled([next, shared]);
        await rejected;
      }
    });
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
