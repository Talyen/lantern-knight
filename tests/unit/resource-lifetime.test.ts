import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { ResourcePool } from '../../src/assets/resource-pool';
import { SceneAssets } from '../../src/assets/scene-assets';
import { AssetRuntime, type PackBatch, type PackLease } from '../../src/assets/loader';
import { DisposalScope, cleanupAfterFailure } from '../../src/assets/cleanup';
import { GamePresentation } from '../../src/presentation/game-scene';
import { EditorView } from '../../src/editor/view';

test('reentrant installation cannot retire the successor batch', () => {
  const assets = new SceneAssets(),
    released: number[] = [];
  const batch = (id: number): PackBatch => ({
    packs: new Map(),
    release: () => {
      released.push(id);
    },
  });
  assets.install(batch(1), () => {
    assets.install(batch(2), () => {});
  });
  assert.deepEqual(released, [1]);
  assets.dispose();
  assert.deepEqual(released, [1, 2]);
});

test('room asset ownership drains failed generations even when an older batch cannot release cleanly', () => {
  const assets = new SceneAssets(),
    released: number[] = [];
  const batch = (id: number): PackBatch => ({
    packs: new Map(),
    release() {
      released.push(id);
      if (id === 1) throw new Error('texture release');
    },
  });
  const failed = () => {
    throw new Error('rebuild');
  };
  assert.throws(() => assets.install(batch(1), failed), /rebuild/);
  assert.throws(() => assets.install(batch(2), failed), /rebuild/);
  assert.throws(() => assets.install(batch(3), () => {}), /texture release/);
  assert.deepEqual(released, [1, 2]);
  assets.dispose();
  assets.dispose();
  assert.deepEqual(released, [1, 2, 3]);
});

test('presentation tears down peer owners and its WebGL renderer after a Three disposal listener throws', () => {
  const calls: string[] = [];
  const record = (name: string) => () => {
    calls.push(name);
  };
  const geometry = new PlaneGeometry();
  geometry.addEventListener('dispose', () => {
    throw new Error('geometry listener');
  });
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.material.addEventListener('dispose', record('material'));
  const presentation: GamePresentation = Object.create(GamePresentation.prototype);
  Object.assign(presentation, {
    combatFeedback: { dispose: record('feedback') },
    sceneEffects: { dispose: record('effects') },
    lookRenderer: { dispose: record('lighting') },
    roomPresentation: { disposeScenery: record('scenery'), disposeResources: record('room') },
    actorPresentation: { dispose: record('actors') },
    aim: mesh,
    flare: new Mesh(new PlaneGeometry(), new MeshBasicMaterial()),
    shadowTexture: { dispose: record('shadow') },
    renderer: { dispose: record('WebGL') },
  });
  const resources = new DisposalScope();
  Object.assign(presentation, { resources });
  resources.own(presentation.renderer);
  resources.own(presentation.shadowTexture);
  resources.defer(() => presentation.disposeRoom());
  resources.own(mesh.geometry);
  resources.own(mesh.material);
  resources.own(presentation.lookRenderer);
  resources.own(presentation.sceneEffects);
  resources.own(presentation.combatFeedback);
  assert.throws(() => presentation.dispose(), /geometry listener/);
  assert.deepEqual(calls, [
    'feedback',
    'effects',
    'lighting',
    'material',
    'scenery',
    'actors',
    'room',
    'shadow',
    'WebGL',
  ]);
  presentation.dispose();
  assert.equal(calls.length, 9);
});

test('editor closes its room assets after renderer failure and disposes only once', async () => {
  const runtime = new AssetRuntime({});
  const view = new EditorView({} as HTMLCanvasElement, runtime);
  const assets = new SceneAssets();
  let released = 0,
    rendererCalls = 0;
  assets.install(
    {
      packs: new Map(),
      release() {
        released++;
      },
    },
    () => {},
  );
  Object.assign(view, {
    accepted: true,
    assets,
    renderer: {
      dispose() {
        rendererCalls++;
        assert.equal(released, 0, 'Renderer closes before borrowed textures release');
        throw new Error('renderer listener');
      },
    },
  });
  assert.throws(() => view.dispose(), /renderer listener/);
  assert.equal(view.presentation, undefined);
  assert.equal(view.sim, undefined);
  assert.equal(released, 1);
  view.dispose();
  assert.equal(rendererCalls, 1);
  await assert.rejects(view.apply({} as never), /closed/);
  runtime.dispose();
});

test('pack batch release drains peers and cancellation reports failing late release', async () => {
  for (const cancelled of [false, true]) {
    const runtime = new AssetRuntime({}),
      released: string[] = [];
    const failure = new Error('pack release');
    const controller = new AbortController();

    const { promise: late, resolve } = Promise.withResolvers<PackLease>();
    const pack = (id: string) =>
      ({
        release() {
          released.push(id);
          if (id === 'broken') throw failure;
        },
      }) as PackLease;
    runtime.loadPack = (id) => (cancelled && id === 'broken' ? late : Promise.resolve(pack(id)));
    const pending = runtime.loadPacks(['peer', 'broken'], controller.signal);
    if (cancelled) {
      // The late lease must be consumed even when it arrives after cancellation.
      controller.abort();
      resolve(pack('broken'));
      await assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[1], failure);
        return true;
      });
    } else {
      const batch = await pending;
      assert.throws(() => batch.release(), /pack release/);
      batch.release();
    }
    assert.deepEqual(released.sort(), ['broken', 'peer']);
    runtime.dispose();
  }
});

test('pack cancellation preserves cleanup errors from a still-pending texture acquisition', async () => {
  const runtime = new AssetRuntime({}),
    controller = new AbortController();
  const failure = new Error('broken texture listener'),
    destroyed: string[] = [];

  const { promise: started, resolve: ready } = Promise.withResolvers<void>();
  const { promise: late, resolve: finish } = Promise.withResolvers<string>();
  const pool = new ResourcePool(
    (id) => (id === 'late' ? late : Promise.resolve(id)),
    (id) => {
      destroyed.push(id);
      if (id === 'broken') throw failure;
    },
  );
  runtime.loadPack = async (_id, signal) => {
    const held = await pool.acquire(['broken', 'late'], signal, () => ready());
    return { release: held.release } as PackLease;
  };
  const pending = runtime.loadPacks(['pack'], controller.signal);
  await started;
  controller.abort();
  finish('late');
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(
      error instanceof AggregateError,
      'Batch cancellation must retain the nested cleanup failure',
    );
    const nested = error.errors[1];
    assert.ok(nested instanceof AggregateError);
    assert.equal(nested.errors[1], failure);
    return true;
  });
  assert.deepEqual(destroyed, ['broken', 'late']);
  runtime.dispose();
  pool.dispose();
});

test('reentrant loaders share the admitted resource owner', async () => {
  let nested: ReturnType<ResourcePool<object>['acquire']> | undefined;
  let loads = 0;
  const destroyed: object[] = [];
  const pool = new ResourcePool<object>(
    () => {
      loads++;
      if (loads === 1) nested = pool.acquire(['shared']);
      return Promise.resolve({});
    },
    (value) => destroyed.push(value),
  );
  const first = await pool.acquire(['shared']);
  const second = await nested!;
  assert.equal(loads, 1);
  assert.equal(first.resources.get('shared'), second.resources.get('shared'));
  first.release();
  assert.equal(destroyed.length, 0);
  second.release();
  assert.deepEqual(destroyed, [first.resources.get('shared')]);
  assert.equal(pool.size, 0);
  pool.dispose();
});

test('loader cancellation retires the whole admitted batch before starting peers', async () => {
  const controller = new AbortController();
  const late = Promise.withResolvers<string>();
  const loads: string[] = [];
  const destroyed: string[] = [];
  const pool = new ResourcePool(
    (id) => {
      loads.push(id);
      controller.abort();
      return late.promise;
    },
    (value) => destroyed.push(value),
  );
  const pending = pool.acquire(['first', 'peer'], controller.signal);
  const rejected = assert.rejects(pending, /cancelled/);
  assert.equal(pool.size, 0, 'Cancellation releases claims before decodes settle');
  late.resolve('late');
  await rejected;
  assert.deepEqual(loads, ['first']);
  assert.deepEqual(destroyed, ['late']);
  pool.dispose();
});

test('loader disposal closes all admitted owners and prevents unstarted work', async () => {
  const late = Promise.withResolvers<string>();
  const loads: string[] = [];
  const destroyed: string[] = [];
  const pool = new ResourcePool(
    (id) => {
      loads.push(id);
      pool.dispose();
      return late.promise;
    },
    (value) => destroyed.push(value),
  );
  const pending = pool.acquire(['first', 'peer']);
  const rejected = assert.rejects(pending, /disposed/);
  assert.equal(pool.size, 0);
  late.resolve('late');
  await rejected;
  assert.deepEqual(loads, ['first']);
  assert.deepEqual(destroyed, ['late']);
  pool.dispose();
});

test('reentrant acquisition survives cancellation of the batch that started its shared load', async () => {
  const controller = new AbortController();
  let nested: ReturnType<ResourcePool<object>['acquire']> | undefined;
  const value = {};
  const loads: string[] = [];
  const destroyed: object[] = [];
  let loadSignal: AbortSignal | undefined;
  const pool = new ResourcePool<object>(
    (id, signal) => {
      loadSignal = signal;
      loads.push(id);
      if (loads.length === 1) nested = pool.acquire(['shared']);
      controller.abort();
      return Promise.resolve(value);
    },
    (value) => destroyed.push(value),
  );
  await assert.rejects(pool.acquire(['shared', 'peer'], controller.signal), /cancelled/);
  const surviving = await nested!;
  assert.deepEqual(loads, ['shared']);
  assert.equal(surviving.resources.get('shared'), value);
  assert.equal(pool.size, 1);
  assert.equal(loadSignal!.aborted, false, 'The independent consumer still needs the decode');
  assert.deepEqual(destroyed, []);
  surviving.release();
  assert.equal(loadSignal!.aborted, true, 'Only the final release revokes the resource lifetime');
  assert.deepEqual(destroyed, [value]);
  assert.equal(pool.size, 0);
  pool.dispose();
});

test('failed construction drains a consumed scope, preserves the cause and rejects reentrant ownership', () => {
  const scope = new DisposalScope(),
    calls: string[] = [];
  scope.own({
    dispose() {
      calls.push('renderer');
    },
  });
  scope.own({
    dispose() {
      calls.push('material');
      throw new Error('listener');
    },
  });
  scope.defer(() => {
    calls.push('closing');
    assert.throws(
      () =>
        scope.own({
          dispose() {
            calls.push('reentrant');
          },
        }),
      /scope closed/,
    );
    scope.dispose();
  });
  const failure = new Error('construction');
  assert.throws(
    () => cleanupAfterFailure(failure, () => scope.dispose()),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, failure);
      return true;
    },
  );
  scope.dispose();
  assert.deepEqual(calls, ['closing', 'reentrant', 'material', 'renderer']);
});
