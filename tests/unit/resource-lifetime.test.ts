import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { ResourcePool } from '../../src/assets/resource-pool';
import { SceneAssets } from '../../src/assets/scene-assets';
import { AssetRuntime, type PackBatch, type PackLease } from '../../src/assets/loader';
import { GamePresentation } from '../../src/presentation/game-scene';
import { EditorView } from '../../src/editor/view';

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
  assert.throws(() => presentation.dispose(), /geometry listener/);
  assert.deepEqual(calls, [
    'feedback',
    'effects',
    'lighting',
    'scenery',
    'actors',
    'room',
    'material',
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
    let resolve!: (pack: PackLease) => void;
    const late = new Promise<PackLease>((done) => {
      resolve = done;
    });
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
  let ready!: () => void, finish!: (value: string) => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const late = new Promise<string>((resolve) => {
    finish = resolve;
  });
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
