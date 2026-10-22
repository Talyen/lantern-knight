import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, OrthographicCamera, Texture } from 'three';
import { DecodeQueue } from '../../src/assets/decode-queue';
import { ResourcePool } from '../../src/assets/resource-pool';
import { SceneAssets } from '../../src/assets/scene-assets';
import { AssetRuntime, type PackBatch, type PackLease } from '../../src/assets/loader';
import { DisposalScope, cleanupAfterFailure } from '../../src/assets/cleanup';
import { GamePresentation } from '../../src/presentation/game-scene';
import { EditorView } from '../../src/editor/view';
import { InkRoom } from '../../src/presentation/ink-room';
import type { PreparedRegistration } from '../../src/assets/registration';
import { manifestFixture } from '../fixtures/manifest';
import { content } from '../fixtures/content';

test('scenery teardown consumes every sprite and shadow even when a sprite destructor fails', () => {
  const manifest = manifestFixture(),
    texture = new Texture(),
    group = new Group();
  const room = new InkRoom(
    content.area('court'),
    new Map([['ink-hero-current', { manifest, textures: new Map([['atlas-0', texture]]) }]]),
    group,
    new OrthographicCamera(),
    texture,
    {} as PreparedRegistration,
    {
      floor: '',
      camera: { bounds: content.area('court').bounds, bias: { x: 0, z: 0 } },
      paths: [],
      walls: [],
      graves: [],
      proceduralAssets: [],
      decals: [],
      props: ['one', 'two'].map((id) => ({
        id,
        purpose: 'regression scenery',
        asset: 'ink-hero-current',
        clip: 'idle',
        x: 0,
        z: 0,
      })),
    },
  );
  room.build();
  const calls: string[] = [];
  for (const sprite of room.sprites) {
    sprite.geometry.addEventListener('dispose', () => {
      calls.push(sprite.id + ':geometry');
      if (sprite.id === 'one') throw new Error('sprite listener');
    });
    sprite.material.addEventListener('dispose', () => {
      calls.push(sprite.id + ':material');
    });
  }
  room.contactShadows!.mesh.geometry.addEventListener('dispose', () => {
    calls.push('shadows');
  });
  assert.throws(() => room.dispose(), /sprite listener/);
  assert.deepEqual(
    new Set(calls),
    new Set(['one:geometry', 'one:material', 'two:geometry', 'two:material', 'shadows']),
  );
  assert.equal(group.children.length, 0);
  room.dispose();
  assert.equal(
    calls.length,
    5,
    'Failed teardown is terminal and does not retry consumed resources',
  );
  texture.dispose();
});

for (const failed of [false, true])
  test(`nested installation retains active rebuild borrows after outer ${failed ? 'failure' : 'success'}`, () => {
    const assets = new SceneAssets(),
      released: number[] = [];
    const batch = (id: number): PackBatch => ({
      packs: new Map([[String(id), {} as PackLease]]),
      release: () => {
        released.push(id);
      },
    });
    const install = () =>
      assets.install(batch(1), () => {
        assets.install(batch(2), () => {});
        assert.deepEqual(released, [], 'The returning outer rebuild still borrows its textures');
        assert.deepEqual([...assets.packs.keys()], ['1', '2']);
        if (failed) throw new Error('outer rebuild failed after its successor');
      });
    if (failed) assert.throws(install, /outer rebuild failed/);
    else install();
    assert.deepEqual(released, []);
    assert.deepEqual([...assets.packs.keys()], ['1', '2']);
    assets.install(batch(3), () => {});
    assert.deepEqual(released, [1, 2]);
    assets.dispose();
    assert.deepEqual(released, [1, 2, 3]);
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

for (const closing of ['cancellation', 'disposal'] as const) {
  test(`loader ${closing} retires every admitted claim before starting peers`, async () => {
    const controller = new AbortController(),
      late = Promise.withResolvers<string>();
    const loads: string[] = [],
      destroyed: string[] = [];
    const pool = new ResourcePool(
      (id) => {
        loads.push(id);
        if (closing === 'cancellation') controller.abort();
        else pool.dispose();
        return late.promise;
      },
      (value) => destroyed.push(value),
    );
    const pending = pool.acquire(['first', 'peer'], controller.signal);
    const rejected = assert.rejects(pending, closing === 'cancellation' ? /cancelled/ : /disposed/);
    assert.equal(pool.size, 0, 'Retirement releases claims before decodes settle');
    late.resolve('late');
    await rejected;
    assert.deepEqual(loads, ['first']);
    assert.deepEqual(destroyed, ['late']);
    pool.dispose();
  });
}

for (const cancelled of [false, true]) {
  test(`reentrant acquisition shares its owner with a ${cancelled ? 'cancelled' : 'completed'} initiating batch`, async () => {
    const controller = new AbortController(),
      value = {};
    let nested: ReturnType<ResourcePool<object>['acquire']> | undefined;
    const loads: string[] = [],
      destroyed: object[] = [];
    let loadSignal: AbortSignal | undefined;
    const pool = new ResourcePool<object>(
      (id, signal) => {
        loadSignal = signal;
        loads.push(id);
        if (loads.length === 1) nested = pool.acquire(['shared']);
        if (cancelled) controller.abort();
        return Promise.resolve(value);
      },
      (value) => destroyed.push(value),
    );
    const pending = pool.acquire(cancelled ? ['shared', 'peer'] : ['shared'], controller.signal);
    if (cancelled) await assert.rejects(pending, /cancelled/);
    else {
      const first = await pending;
      assert.equal(first.resources.get('shared'), value);
      first.release();
    }
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
}

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

test('closing a decode queue revokes admitted work before its scheduled native call starts', async () => {
  const queue = new DecodeQueue(1);
  let started = 0;
  const work = async () => ++started;
  const active = queue.run(work),
    waiting = queue.run(work);
  const rejected = Promise.all([
    assert.rejects(active, /disposed/),
    assert.rejects(waiting, /disposed/),
  ]);
  queue.dispose();
  await rejected;
  assert.equal(started, 0);
});
