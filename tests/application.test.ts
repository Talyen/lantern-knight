import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../src/application';
import { AssetRuntime, type PackLease } from '../src/assets/loader';
import type { GamePresentation } from '../src/presentation/game-scene';
import { content } from '../src/content/world';
import type { Bridge } from '../src/core/save';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function fixture() {
  const app = new Application(
    { dataset: {} } as unknown as HTMLCanvasElement,
    content,
    {},
    {} as Bridge,
    () => ({}) as GamePresentation,
    { status: () => {}, pause: () => {}, frame: () => {} },
  );
  let released = 0,
    warmed = 0;
  const lease = { release: () => released++ } as unknown as PackLease;
  app.presentation = { warmPack: () => warmed++, dispose: () => {} } as unknown as GamePresentation;
  return {
    app,
    lease,
    get released() {
      return released;
    },
    get warmed() {
      return warmed;
    },
  };
}
test('gallery requests share one lease; disposal and failed warming release acquisitions', async () => {
  const f = fixture(),
    pending = deferred<PackLease>();
  let loads = 0;
  f.app.runtime = {
    loadPack: () => {
      loads++;
      return pending.promise;
    },
  } as unknown as AssetRuntime;
  const first = f.app.loadAsset('gallery'),
    second = f.app.loadAsset('gallery');
  pending.resolve(f.lease);
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.equal(f.warmed, 1);
  assert.equal(f.app.packs.get('gallery'), f.lease);
  const cancel = globalThis.cancelAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  const win = globalThis.window,
    doc = globalThis.document;
  globalThis.window = { removeEventListener: () => {} } as unknown as Window & typeof globalThis;
  globalThis.document = { removeEventListener: () => {} } as unknown as Document;
  try {
    f.app.dispose();
    f.app.dispose();
    assert.equal(f.released, 1);
    await assert.rejects(f.app.loadAsset('gallery'), /disposed/);
    const late = fixture(),
      wait = deferred<PackLease>();
    late.app.runtime = { loadPack: () => wait.promise } as unknown as AssetRuntime;
    const loading = late.app.loadAsset('gallery');
    late.app.dispose();
    wait.resolve(late.lease);
    await assert.rejects(loading, /disposed/);
    assert.equal(late.released, 1);
    assert.equal(late.warmed, 0);
    assert.equal(late.app.packs.size, 0);
    const failure = fixture();
    failure.app.runtime = { loadPack: async () => failure.lease } as unknown as AssetRuntime;
    failure.app.presentation.warmPack = () => {
      throw new Error('GPU unavailable');
    };
    await assert.rejects(failure.app.loadAsset('gallery'), /GPU unavailable/);
    assert.equal(failure.released, 1);
    failure.app.presentation.warmPack = () => {};
    await failure.app.loadAsset('gallery');
    assert.equal(failure.app.packs.size, 1);
    failure.app.dispose();
  } finally {
    globalThis.cancelAnimationFrame = cancel;
    globalThis.window = win;
    globalThis.document = doc;
  }
});
test('startup disposed while opening its catalog cannot acquire assets or become ready', async () => {
  const f = fixture(),
    opening = deferred<AssetRuntime>(),
    open = AssetRuntime.open;
  AssetRuntime.open = () => opening.promise;
  const cancel = globalThis.cancelAnimationFrame,
    win = globalThis.window,
    doc = globalThis.document;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.window = { removeEventListener: () => {} } as unknown as Window & typeof globalThis;
  globalThis.document = { removeEventListener: () => {} } as unknown as Document;
  try {
    const boot = f.app.boot();
    f.app.dispose();
    opening.resolve({
      loadPack: () => {
        throw new Error('unexpected acquisition');
      },
    } as unknown as AssetRuntime);
    await assert.rejects(boot, /disposed/);
    assert.equal(f.app.ready, false);
    assert.equal(f.app.canvas.dataset.ready, undefined);
  } finally {
    AssetRuntime.open = open;
    globalThis.cancelAnimationFrame = cancel;
    globalThis.window = win;
    globalThis.document = doc;
  }
});
