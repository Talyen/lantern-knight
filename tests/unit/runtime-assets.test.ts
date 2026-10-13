import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'three';
import { AssetRuntime } from '../../src/assets/loader';
import { resolveClip } from '../../src/assets/schema';
import { manifestFixture } from '../fixtures/manifest';

for (const seeded of [false, true]) {
  test(`${seeded ? 'seeded' : 'fetched'} manifests keep validated pages, geometry and timing immutable`, async () => {
    const draft = manifestFixture('hero'),
      catalog = { hero: 'generated/hero.json' },
      requests: string[] = [],
      decoded: string[] = [],
      runtime = new AssetRuntime(
        catalog,
        false,
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
    try {
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
    } finally {
      runtime.dispose();
    }
  });
}

test('both manifest entry paths reject mismatched identity before decoding and preserve retry', async () => {
  const draft = manifestFixture('wrong');
  let decoded = 0;
  const runtime = new AssetRuntime(
    { hero: 'generated/hero.json' },
    false,
    async () => new Response(JSON.stringify(draft)),
    async () => {
      decoded++;
      return new Texture();
    },
    (texture) => texture.dispose(),
  );
  try {
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
  } finally {
    runtime.dispose();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

for (const cancelled of [false, true]) {
  test(`${cancelled ? 'cancelled' : 'failed'} pack batches release claims before late peers settle`, async () => {
    const ready = manifestFixture('ready'),
      late = manifestFixture('late');
    late.pages[0]!.hash = 'c'.repeat(64);
    const pendingTexture = deferred<Texture>(),
      pendingManifest = deferred<Response>(),
      destroyed: Texture[] = [],
      texture = new Texture(),
      lateTexture = new Texture(),
      controller = new AbortController(),
      runtime = new AssetRuntime(
        { ready: 'generated/ready.json', late: 'generated/late.json', bad: 'generated/bad.json' },
        false,
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
    try {
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
    } finally {
      pendingTexture.resolve(lateTexture);
      if (!cancelled) pendingManifest.reject(new Error('manifest failed'));
      await rejected;
      runtime.dispose();
    }
  });
}
