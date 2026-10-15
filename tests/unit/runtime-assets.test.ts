import { onAsyncExit, onExit } from '../../tools/scope-exit';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'three';
import { AssetRuntime, type PackLease } from '../../src/assets/loader';
import { resolveClip } from '../../src/assets/schema';
import { manifestFixture } from '../fixtures/manifest';
import { TextureDelivery } from '../../src/assets/texture-delivery';
import { mockGlobals } from '../fixtures/globals';
import { AssetByteSource } from '../../src/assets/byte-source';
import { runtimeBundles } from '../../tools/build-runtime-delivery';

for (const phase of ['policy', 'registration-body'] as const) {
  test(`cancelling runtime opening during ${phase} settles without transport and closes staged ownership`, async (t) => {
    const controller = new AbortController(),
      response = Promise.withResolvers<Response>(),
      body = Promise.withResolvers<ArrayBuffer>(),
      started = Promise.withResolvers<void>(),
      signals: AbortSignal[] = [];
    let settled = false,
      requests = 0;
    const dispose = t.mock.method(AssetRuntime.prototype, 'dispose');
    mockGlobals(t, {
      fetch: async (_url: unknown, init: RequestInit) => {
        requests++;
        signals.push(init.signal!);
        if (phase === 'policy') {
          started.resolve();
          return response.promise;
        }
        if (requests === 1) return new Response('{}');
        return Object.assign(new Response(), {
          arrayBuffer: () => {
            started.resolve();
            return body.promise;
          },
        });
      },
    });
    const opening = AssetRuntime.open(
      {},
      undefined,
      'delivery',
      'authoring',
      undefined,
      controller.signal,
    );
    const result = opening.catch((error: unknown) => {
      settled = true;
      return error;
    });
    try {
      await started.promise;
      controller.abort(new Error('opening cancelled'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(settled, true, 'Transport may ignore abort indefinitely');
      assert.match(String(await result), /opening cancelled/);
      assert.ok(signals.every((signal) => signal.aborted));
      assert.equal(dispose.mock.callCount(), phase === 'policy' ? 0 : 1);
    } finally {
      // A late transport failure must stay observed and cannot reopen resources.
      if (phase === 'policy') response.reject(new Error('late transport failure'));
      else response.resolve(new Response());
      // This body is only observed in the registration case.
      body.resolve(new ArrayBuffer(0));
      await result;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(requests, phase === 'policy' ? 1 : 2);
    assert.equal(dispose.mock.callCount(), phase === 'policy' ? 0 : 1);
  });
}

test('retiring a room cancels obsolete image work so the next room can decode', async (t) => {
  mockGlobals(t, {
    createImageBitmap: async () => ({ width: 64, height: 64, close() {} }),
  });
  const canvas = {
    getContext: () => ({ MAX_TEXTURE_SIZE: 1, getParameter: () => 8192, getExtension: () => null }),
    ownerDocument: { querySelector: () => null },
  } as unknown as HTMLCanvasElement;
  const started = Promise.withResolvers<void>(),
    signals: AbortSignal[] = [],
    stalls: ReturnType<typeof Promise.withResolvers<Response>>[] = [],
    obsolete = new AbortController();
  const ids = Array.from({ length: 6 }, (_, i) => 'old-' + i),
    built = await runtimeBundles(
      new Map([...ids, 'next'].map((id) => [id, new Set([`generated/${id}/atlas.png`])])),
      async () => Buffer.from('abc'),
    ),
    source = new AssetByteSource(built.bundles, async (url, init) => {
      if (typeof url === 'string' && url.startsWith('/runtime-assets/next-'))
        return new Response('abc');
      const stall = Promise.withResolvers<Response>();
      stalls.push(stall);
      const signal = init!.signal!;
      signals.push(signal);
      signal.addEventListener('abort', () => stall.reject(signal.reason), { once: true });
      if (signals.length === 6) started.resolve();
      return stall.promise;
    });
  let uploads = 0;
  const delivery = new TextureDelivery(canvas, 'delivery', source.request, () => {
    uploads++;
  });
  const runtime = new AssetRuntime(
    Object.fromEntries([...ids, 'next'].map((id) => [id, `generated/${id}/manifest.json`])),
    undefined,
    undefined,
    undefined,
    delivery,
  );
  for (const [i, id] of [...ids, 'next'].entries()) {
    const manifest = manifestFixture(id);
    manifest.pages[0]!.hash =
      id === 'next'
        ? 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        : String(i).repeat(64);
    runtime.seedManifest(id, manifest);
  }
  const loading = runtime.loadPacks(ids, obsolete.signal),
    rejected = assert.rejects(loading, /cancelled/);
  let next: Promise<PackLease> | undefined;
  await using _scopeExit2 = onAsyncExit(async () => {
    for (const stall of stalls) stall.reject(new Error('test cleanup'));
    await Promise.allSettled([loading, ...(next ? [next.then((pack) => pack.release())] : [])]);
    runtime.dispose();
    source.dispose();
  });
  await started.promise;
  next = runtime.loadPack('next');
  obsolete.abort();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(
    signals.every((signal) => signal.aborted),
    'Last claims must cancel downloads',
  );
  const held = await next;
  await rejected;
  assert.equal(uploads, 1, 'Only the accepted room uploads an image');
  held.release();
  assert.equal(runtime.resourceCount, 0);
});

test('cancelling a manifest wait leaves shared transport available to another room', async () => {
  const response = Promise.withResolvers<Response>(),
    controller = new AbortController();
  let requests = 0;
  const runtime = new AssetRuntime(
    { hero: 'generated/hero.json' },
    () => {
      requests++;
      return response.promise;
    },
    async () => new Texture(),
    (texture) => texture.dispose(),
  );
  const obsolete = runtime.loadPacks(['hero'], controller.signal),
    rejected = assert.rejects(obsolete, /cancelled/),
    surviving = runtime.loadPack('hero');
  await using _scopeExit1 = onAsyncExit(async () => {
    response.resolve(new Response(JSON.stringify(manifestFixture('hero'))));
    await surviving.then((held) => held.release());
    runtime.dispose();
  });
  controller.abort();
  await rejected;
  response.resolve(new Response(JSON.stringify(manifestFixture('hero'))));
  const held = await surviving;
  assert.equal(requests, 1);
  held.release();
});

for (const seeded of [false, true]) {
  test(`${seeded ? 'seeded' : 'fetched'} manifests keep validated pages, geometry and timing immutable`, async () => {
    const draft = manifestFixture('hero'),
      catalog = { hero: 'generated/hero.json' },
      requests: string[] = [],
      decoded: string[] = [],
      runtime = new AssetRuntime(
        catalog,
        async (url) => {
          requests.push(url instanceof Request ? url.url : url.toString());
          return new Response(JSON.stringify(draft));
        },
        async (page) => {
          decoded.push(page.hash);
          return new Texture();
        },
        (texture) => texture.dispose(),
      );
    using _cleanup2 = onExit(() => runtime.dispose());
    if (seeded) runtime.seedManifest('hero', draft);
    catalog.hero = 'generated/changed.json';
    const manifest = await runtime.manifest('hero'),
      clip = resolveClip(manifest, 'idle', 'd45');
    assert.equal(Reflect.set(manifest.pages[0]!, 'hash', 'c'.repeat(64)), false);
    assert.equal(Reflect.set(manifest.frames[0]!.trim, '0', 99), false);
    assert.equal(Reflect.set(clip.durationsMs, '0', 9999), false);
    assert.equal(Reflect.set(runtime.catalog, 'hero', 'generated/changed.json'), false);
    draft.pages[0]!.hash = 'd'.repeat(64);
    draft.frames[0]!.trim[0] = 99;
    draft.asset.clips.idle!.d45!.durationsMs[0] = 9999;
    const pack = await runtime.loadPack('hero');
    assert.equal(pack.manifest, manifest);
    assert.deepEqual(decoded, ['b'.repeat(64)]);
    assert.equal(pack.manifest.frames[0]!.trim[0], 0);
    assert.notEqual(clip.durationsMs[0], 9999);
    assert.deepEqual(requests, seeded ? [] : ['/generated/hero.json']);
    pack.release();

    // oxlint-disable-next-line no-constant-condition -- Compile-only checks for descriptor consumers.
    if (false) {
      // @ts-expect-error Accepted atlas identities cannot change.
      manifest.pages[0]!.hash = 'changed';
      // @ts-expect-error Accepted geometry cannot change.
      manifest.frames[0]!.trim[0] = 99;
      // @ts-expect-error Animation consumers borrow immutable timing.
      clip.durationsMs.push(100);
    }
  });
}

test('both manifest entry paths reject mismatched identity before decoding and preserve retry', async () => {
  const draft = manifestFixture('wrong');
  let decoded = 0;
  const runtime = new AssetRuntime(
    { hero: 'generated/hero.json' },
    async () => new Response(JSON.stringify(draft)),
    async () => {
      decoded++;
      return new Texture();
    },
    (texture) => texture.dispose(),
  );
  using _cleanup1 = onExit(() => runtime.dispose());
  assert.throws(() => runtime.seedManifest('hero', draft), /identity differs/);
  await assert.rejects(runtime.loadPack('hero'), /identity differs/);
  assert.equal(decoded, 0);
  assert.equal(runtime.resourceCount, 0);
  draft.asset.id = 'hero';
  const held = await runtime.loadPack('hero');
  assert.equal(held.manifest.asset.id, 'hero');
  assert.equal(decoded, 1);
  assert.throws(() => runtime.seedManifest('hero', manifestFixture('wrong')), /identity differs/);
  assert.equal(await runtime.manifest('hero'), held.manifest);
  held.release();
});

for (const cancelled of [false, true]) {
  test(`${cancelled ? 'cancelled' : 'failed'} pack batches release claims before late peers settle`, async () => {
    const ready = manifestFixture('ready'),
      late = manifestFixture('late');
    late.pages[0]!.hash = 'c'.repeat(64);
    const pendingTexture = Promise.withResolvers<Texture>(),
      pendingManifest = Promise.withResolvers<Response>(),
      destroyed: Texture[] = [],
      texture = new Texture(),
      lateTexture = new Texture(),
      controller = new AbortController(),
      runtime = new AssetRuntime(
        { ready: 'generated/ready.json', late: 'generated/late.json', bad: 'generated/bad.json' },
        () => pendingManifest.promise,
        async (page) => (page.hash === ready.pages[0]!.hash ? texture : pendingTexture.promise),
        (value) => destroyed.push(value),
      );
    runtime.seedManifest('ready', ready);
    runtime.seedManifest('late', late);
    let settled = false;
    const loading = runtime.loadPacks(
      cancelled ? ['ready', 'late'] : ['ready', 'late', 'bad'],
      controller.signal,
    );
    const rejected = assert.rejects(
      loading.finally(() => {
        settled = true;
      }),
      cancelled ? /cancelled/ : /manifest failed/,
    );
    await using _scopeExit3 = onAsyncExit(async () => {
      pendingTexture.resolve(lateTexture);
      if (!cancelled) pendingManifest.reject(new Error('manifest failed'));
      await rejected;
      runtime.dispose();
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Another consumer owns its own claim on the completed pack's texture.
    const peer = await runtime.loadPack('ready');
    assert.equal(runtime.resourceCount, 2);
    if (cancelled) controller.abort();
    else pendingManifest.reject(new Error('manifest failed'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'Late results must still be observed');
    assert.equal(runtime.resourceCount, 1, 'Only the independent consumer retains a claim');
    assert.deepEqual(destroyed, []);
    peer.release();
    assert.deepEqual(destroyed, [texture], 'Completed packs release before pending peers settle');
    pendingTexture.resolve(lateTexture);
    await rejected;
    assert.deepEqual(destroyed, [texture, lateTexture]);
    assert.equal(runtime.resourceCount, 0);
  });
}
