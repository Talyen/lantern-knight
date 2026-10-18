import { onExit } from '../../tools/scope-exit';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Texture, Vector3 } from 'three';
import { EditorView } from '../../src/editor/view';
import { EditorDocument } from '../../src/editor/document';
import { emptyScene } from '../../src/editor/default-scene';
import { AssetRuntime, type PackLease } from '../../src/assets/loader';
import { manifestFixture } from '../fixtures/manifest';
import { makeCamera, outward } from '../../src/presentation/camera';
import { Simulation } from '../../src/core/simulation';
import { ContentRegistry, heightAt } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';
import { gameScenes } from '../../src/content/game-content';

test('editor acquires shared presentation resources before warming and retains them until disposal', async () => {
  const ids = new Set([...gameScenes.initialAssets, 'ink-moss']);
  const runtime = new AssetRuntime(
    Object.fromEntries([...ids].map((id) => [id, `generated/${id}/manifest.json`])),
  );
  const released: string[] = [];
  runtime.loadPack = async (id) => {
    const manifest = manifestFixture(id);
    if (id === 'ink-moss') {
      manifest.asset.type = 'material';
      manifest.asset.projection = 'top-down';
    }
    return { manifest, textures: new Map(), release: () => released.push(id) };
  };
  let warmed = false;
  const view = new EditorView({} as HTMLCanvasElement, runtime, (_canvas, packs) => {
    return {
      scene: new Group(),
      overlay: new Group(),
      roomPresentation: {},
      async warm() {
        for (const id of gameScenes.initialAssets)
          assert.ok(packs.has(id), 'Shared presentation asset missing before warming: ' + id);
        assert.deepEqual(released, []);
        warmed = true;
      },
      lookRenderer: { setSettings() {}, async prepare() {} },
      dispose() {},
    } as unknown as NonNullable<EditorView['presentation']>;
  });
  try {
    const document = emptyScene();
    delete document.floor.clip;
    await view.apply(document);
    assert.equal(warmed, true);
    assert.ok(view.presentation);
    assert.deepEqual(released, []);
  } finally {
    view.dispose();
    runtime.dispose();
  }
  assert.deepEqual(new Set(released), ids);
  assert.equal(released.length, ids.size);
});

test('editor ground picking follows elevated surfaces while explicit drag planes retain their height', () => {
  for (const surface of [
    { kind: 'flat' as const, height: 2 },
    { kind: 'ramp' as const, axis: 'x' as const, start: -5, end: 5, startHeight: 0, endHeight: 2 },
  ]) {
    const definitions = structuredClone(contentDefinitions);
    definitions.areas[0]!.surface = surface;
    const simulation = new Simulation(new ContentRegistry(definitions));
    const camera = makeCamera(4 / 3, new Vector3(0, heightAt(simulation.areaDefinition, 0, 0), 0));
    const view = new EditorView(
      {
        getBoundingClientRect: () => ({ left: 80, top: 70, width: 800, height: 600 }),
      } as HTMLCanvasElement,
      new AssetRuntime({}),
    );
    Object.assign(view, { accepted: true, renderer: { camera }, simulation });
    const point = new Vector3(1, heightAt(simulation.areaDefinition, 1, 2), 2);
    const screen = view.screen(point);
    assert.ok(view.ground(screen.x, screen.y)!.distanceTo(point) < 1e-7);
    assert.equal(view.ground(screen.x, screen.y, 0)!.y, 0);
  }
});

test('invisible artwork cannot intercept selection of the visible drawing behind it', () => {
  const camera = makeCamera(4 / 3),
    texture = new Texture();
  const sprites = ['visible', 'invisible'].map((id, i) => {
    const material = new MeshBasicMaterial({ map: texture, opacity: i ? 0 : 1 });
    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    mesh.quaternion.copy(camera.quaternion);
    mesh.position.copy(outward).multiplyScalar(i * 0.5);
    return { id, mesh, material };
  });
  const view = new EditorView(
    {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as HTMLCanvasElement,
    new AssetRuntime({}),
  );
  Object.assign(view, {
    accepted: true,
    renderer: { camera, roomPresentation: { inkRoom: { sprites } } },
    alpha: new WeakMap([[texture, { data: new Uint8Array([255]), width: 1, height: 1 }]]),
  });
  const document = emptyScene();
  document.objects = sprites.map(({ id }) => ({
    id,
    kind: 'prop',
    asset: 'ink-scenery',
    clip: 'lantern',
    x: 0,
    z: 0,
  }));
  using _scopeExit1 = onExit(() => {
    for (const sprite of sprites) {
      sprite.mesh.geometry.dispose();
      sprite.material.dispose();
    }
    texture.dispose();
  });
  assert.equal(view.pick(400, 300, document)?.placement.id, 'visible');
  sprites[1]!.material.opacity = 1;
  sprites[1]!.mesh.visible = false;
  assert.equal(view.pick(400, 300, document)?.placement.id, 'visible');
});

test('editor acceptance hides failed rebuilds, recovers and preserves installed texture lifetimes', async () => {
  const original = emptyScene();
  delete original.floor.clip;
  const loaded: PackLease[] = [],
    released: PackLease[] = [],
    runtime = new AssetRuntime({
      'ink-moss': 'generated/moss.json',
      'ink-mud': 'generated/mud.json',
    });
  runtime.loadPack = async (id) => {
    const manifest = manifestFixture(id);
    manifest.asset.type = 'material';
    manifest.asset.projection = 'top-down';
    const pack = { manifest, textures: new Map(), release: () => released.push(pack) };
    loaded.push(pack);
    return pack;
  };
  let failLighting = 0;
  let frames = 0;
  let warmCalls = 0;
  let referenced: PackLease | undefined;
  const presentation = {
    scene: new Group(),
    overlay: new Group(),
    async warm() {
      if (++warmCalls === 1) {
        throw new Error('warm failed');
      }
    },
    update() {
      frames++;
    },
    roomPresentation: {},
    resetRoom() {
      if (referenced)
        assert.equal(
          released.includes(referenced),
          false,
          'Previous renderer textures stay alive until rebuilding discards their references',
        );
      referenced = loaded.at(-1);
    },
    lookRenderer: {
      setSettings() {},
      async prepare() {
        if (failLighting) {
          failLighting--;
          throw new Error('lighting failed');
        }
      },
    },
    dispose() {
      assert.equal(released.includes(loaded.at(-1)!), false);
    },
  };
  const view = new EditorView(
    {} as HTMLCanvasElement,
    runtime,
    () => presentation as unknown as NonNullable<EditorView['presentation']>,
  );
  const documents = new EditorDocument(
    original,
    async (document) => {
      await view.apply(document);
      assert.equal(released.includes(loaded.at(-1)!), false);
    },
    () => {},
    new AbortController().signal,
  );
  using _cleanup1 = onExit(() => runtime.dispose());
  await assert.rejects(view.apply(original), /warm failed/);
  assert.equal(view.presentation, undefined);
  await view.apply(original);
  assert.equal(warmCalls, 2, 'Recovery retries incomplete renderer warming');
  failLighting = 1;
  await assert.rejects(
    documents.edit((history) =>
      history.change((d) => {
        d.floor.asset = 'ink-mud';
      }),
    ),
    /lighting failed/,
  );
  assert.equal(documents.history.document.floor.asset, original.floor.asset);
  assert.equal(loaded.length, 4, 'Rollback reacquires the accepted document before rebuilding');
  assert.deepEqual(released, loaded.slice(0, 3));
  assert.equal(view.presentation, presentation);
  view.render();
  assert.equal(frames, 1);

  const loadPack = runtime.loadPack.bind(runtime);
  runtime.loadPack = async () => {
    throw new Error('pack unavailable');
  };
  const replacing = view.apply({ ...original, floor: { ...original.floor, asset: 'ink-mud' } });
  assert.equal(view.presentation, undefined, 'Pending replacement suspends borrowing');
  await assert.rejects(view.apply(original), /Scene update in progress/);
  await assert.rejects(replacing, /pack unavailable/);
  runtime.loadPack = loadPack;
  assert.equal(view.presentation, presentation, 'Precommit failure preserves room acceptance');

  failLighting = 2;
  await assert.rejects(
    documents.edit((history) =>
      history.change((d) => {
        d.floor.asset = 'ink-mud';
      }),
    ),
    /Scene update and view recovery failed/,
  );
  assert.equal(documents.history.document.floor.asset, original.floor.asset);
  assert.equal(view.presentation, undefined, 'Failed rollback cannot expose a partial renderer');
  assert.equal(view.sim, undefined, 'Rejected gameplay geometry stays behind the same barrier');
  view.render();
  assert.equal(frames, 1, 'Frame scheduling cannot resume the rejected scene');
  assert.equal(view.ground(0, 0), null);
  assert.equal(view.pick(0, 0, original), undefined);
  await view.apply(original);
  assert.equal(view.presentation, presentation);
  view.render();
  assert.equal(frames, 2, 'A successful rebuild reopens the view');
  view.dispose();
  assert.equal(view.presentation, undefined);
  view.render();
  assert.equal(frames, 2);
  assert.deepEqual(released, loaded);
});

test(
  'placement selection and clearing cancel obsolete claims without waiting for asset transport',
  { timeout: 2000 },
  async () => {
    const requests: { signal: AbortSignal; resolve: (pack: PackLease) => void }[] = [];
    const runtime = new AssetRuntime({});
    runtime.loadPack = (_id, signal) => {
      const pending = Promise.withResolvers<PackLease>();
      requests.push({ signal: signal!, resolve: pending.resolve });
      return pending.promise;
    };
    const view = new EditorView({} as HTMLCanvasElement, runtime);
    Object.assign(view, { accepted: true });
    const old = view.placementGhost('old', 'idle', '0', new Vector3());
    const next = view.placementGhost('next', 'idle', '0', new Vector3());
    assert.equal(requests[0]!.signal.aborted, true);
    view.clearPlacementGhost();
    assert.equal(requests[1]!.signal.aborted, true);
    await Promise.all([old, next]);
    let releases = 0;
    for (const request of requests)
      request.resolve({ release: () => releases++ } as unknown as PackLease);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(releases, 2);
    view.dispose();
  },
);

test('reentrant ghost cancellation keeps the newest selection as the only admitted request', async () => {
  const requests: { id: string; signal: AbortSignal; resolve: (pack: PackLease) => void }[] = [];
  const runtime = new AssetRuntime({});
  runtime.loadPack = (id, signal) => {
    const pending = Promise.withResolvers<PackLease>();
    requests.push({ id, signal: signal!, resolve: pending.resolve });
    return pending.promise;
  };
  const view = new EditorView({} as HTMLCanvasElement, runtime);
  Object.assign(view, { accepted: true });
  const old = view.placementGhost('old', 'idle', '0', new Vector3());
  let newest: Promise<void> | undefined;
  requests[0]!.signal.addEventListener(
    'abort',
    () => {
      newest = view.placementGhost('newest', 'idle', '0', new Vector3());
    },
    { once: true },
  );
  const superseded = view.placementGhost('superseded', 'idle', '0', new Vector3());
  assert.deepEqual(
    requests.map((r) => r.id),
    ['old', 'newest'],
  );
  view.clearPlacementGhost();
  for (const request of requests) request.resolve({ release() {} } as unknown as PackLease);
  await Promise.all([old, superseded, newest]);
  view.dispose();
});
