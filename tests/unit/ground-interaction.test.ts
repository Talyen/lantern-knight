import { groundPlacementPolicy } from '../../src/content/scene-placement';
import { resolveScene } from '../../src/content/world-art';
import { Navigation } from '../../src/core/navigation';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import {
  GroundInteractionSchema,
  resizeGroundInteraction,
} from '../../src/content/ground-interaction';
import {
  parseSceneDocument,
  sceneBytesLimit,
  fragmentBytesLimit,
  validateSceneReferences,
} from '../../src/content/scene-document';
import { sceneFixture } from '../fixtures/scene';
import { regionDepth } from '../../src/presentation/ground-occlusion';
import { traceMask } from '../../src/editor/mask-contours';
import { outward } from '../../src/presentation/camera';
import { manifestFixture } from '../fixtures/manifest';
import { emptyScene } from '../../src/editor/default-scene';
const ground = () =>
  GroundInteractionSchema.parse({
    asset: 'ink-moss',
    frame: 'frame',
    hash: 'a'.repeat(64),
    dimensions: [6144, 4096],
    regions: [
      {
        id: 'tree',
        name: 'Tree',
        footprint: [
          { x: -1, z: 0 },
          { x: 0, z: 1 },
          { x: 1, z: 0 },
        ],
        mask: [
          {
            outer: [
              [0.2, 0.2],
              [0.8, 0.2],
              [0.8, 0.8],
              [0.2, 0.8],
            ],
            holes: [
              [
                [0.4, 0.4],
                [0.4, 0.6],
                [0.6, 0.6],
                [0.6, 0.4],
              ],
            ],
          },
        ],
        depth: { kind: 'anchor', point: { x: 0, z: 1 } },
      },
    ],
    destinations: [{ name: 'test', x: 0, z: 0 }],
  });
test('artwork coordinates round trip and resize all world geometry together', () => {
  const before = artworkFloorLayout(40, 26.666),
    after = artworkFloorLayout(20, 30);
  for (const uv of [
    [0, 0],
    [1, 1],
    [0.32, 0.78],
  ]) {
    const actual = before.uv(before.world(uv));
    assert.ok(actual.every((v, i) => Math.abs(v - uv[i]!) < 1e-12));
  }
  const g = ground();
  g.regions.push({
    id: 'wall',
    name: 'Wall',
    depth: { kind: 'boundary', points: [before.world([0.2, 0.3]), before.world([0.8, 0.6])] },
  });
  g.destinations[0] = { name: 'Passage', ...before.world([0.7, 0.8]) };
  const old = structuredClone(g);
  resizeGroundInteraction(g, { width: 40, depth: 26.666 }, { width: 20, depth: 30 });
  assert.deepEqual(g.regions[0]!.mask, old.regions[0]!.mask);
  const a = before.uv(old.regions[0]!.footprint![0]!),
    b = after.uv(g.regions[0]!.footprint![0]!);
  assert.ok(a.every((v, i) => Math.abs(v - b[i]!) < 1e-12));
  const points = (value: typeof g) =>
    value.regions
      .flatMap((r) => (r.depth?.kind === 'anchor' ? [r.depth.point] : (r.depth?.points ?? [])))
      .concat(value.destinations);
  for (const [index, point] of points(old).entries()) {
    const uv = before.uv(point),
      resized = after.uv(points(g)[index]!);
    assert.ok(uv.every((v, i) => Math.abs(v - resized[i]!) < 1e-12));
  }
});
test('top-left image coordinates register with the actual camera projection', () => {
  const layout = artworkFloorLayout(40, 26.666);
  for (const [u, v] of [
    [0, 0],
    [1, 1],
    [0.2, 0.7],
  ]) {
    const p = layout.world([u!, v!]);
    // The camera up axis has negative XZ components: points farther away appear higher.
    const screenUp =
      (-Math.sin(Math.atan2(outward.y, Math.hypot(outward.x, outward.z))) * (p.x + p.z)) /
      Math.sqrt(2);
    assert.ok(Math.abs(screenUp - (0.5 - v!) * 26.666) < 1e-9);
  }
});
test('depth boundaries interpolate across artwork columns and reject ambiguous ordering', () => {
  const g = ground(),
    layout = artworkFloorLayout(40, 26.666),
    a = layout.world([0.2, 0.4]),
    b = layout.world([0.8, 0.7]);
  g.regions[0]!.depth = { kind: 'boundary', points: [a, b] };
  assert.ok(
    Math.abs(
      regionDepth(g.regions[0]!, 0.5, layout) -
        ((a.x + b.x) * outward.x + (a.z + b.z) * outward.z) / 2,
    ) < 1e-9,
  );
  g.regions[0]!.depth = { kind: 'boundary', points: [b, a] };
  assert.throws(() => GroundInteractionSchema.parse(g), /left to right/);
});
test('scene masks preserve holes through parsing; identity replacement and oversized drafts are rejected', () => {
  const d = sceneFixture('graveyard');
  d.floor.layout = 'artwork';
  d.groundInteraction = ground();
  assert.deepEqual(
    parseSceneDocument(JSON.parse(JSON.stringify(d))).groundInteraction,
    d.groundInteraction,
  );
  assert.equal(sceneBytesLimit, 4 * 1024 * 1024);
  assert.equal(fragmentBytesLimit, 64 * 1024);
  d.floor.asset = 'replacement';
  assert.throws(() => parseSceneDocument(d), /original single-image/);
  d.floor.asset = 'ink-moss';
  const dense = Array.from({ length: 300000 }, (_, i) => [i / 300000, 0.5] as [number, number]);
  d.groundInteraction.regions[0]!.mask![0]!.outer = dense;
  assert.throws(() => parseSceneDocument(d), /4 MiB/);
});
test('manual mask tracing preserves separate islands, diagonal contact, and holes', () => {
  const width = 12,
    height = 12,
    data = new Uint8ClampedArray(width * height * 4);
  const pixel = (x: number, y: number) => {
    data[(y * width + x) * 4 + 3] = 255;
  };
  for (let y = 1; y < 8; y++)
    for (let x = 1; x < 8; x++) if (!(x >= 3 && x <= 5 && y >= 3 && y <= 5)) pixel(x, y);
  pixel(9, 9);
  pixel(10, 10);
  const shapes = traceMask(data, width, height);
  assert.equal(shapes.length, 3);
  assert.equal(
    shapes.reduce((n, s) => n + s.holes.length, 0),
    1,
  );
  for (const shape of shapes) assert.ok(shape.outer.length >= 4);
});

test('asset delivery reprocessing preserves scene interactions; changed painting is flagged without deleting authored data', async (t) => {
  const { SceneStore } = await import('../../tools/scene/scene-editor-store');
  const directory = await temporaryDirectory(t, 'ground-reprocessing-');

  const d = emptyScene(),
    m = manifestFixture('ink-moss');
  d.floor.layout = 'artwork';
  d.groundInteraction = ground();
  m.asset.type = 'material';
  m.asset.projection = 'top-down';
  m.asset.canvas = [...d.groundInteraction.dimensions];
  m.asset.clips.surface = { d45: structuredClone(m.asset.clips.idle!.d45!) };
  d.groundInteraction.frame = m.asset.clips.surface.d45!.frames[0]!;
  d.groundInteraction.hash = m.pages[0]!.hash;
  const manifests = new Map([[m.asset.id, m]]),
    store = new SceneStore(directory);
  await store.save(d, null);
  const original = await store.read(d.id);
  // Delivery metadata, version and filenames may change while lossless artwork stays identical.
  m.hash = 'c'.repeat(64);
  m.toolVersion = 'reprocessed-delivery';
  m.pages[0]!.path = 'reprocessed/painting.png';
  validateSceneReferences(d, manifests);
  assert.deepEqual(await store.read(d.id), original);
  m.pages[0]!.hash = 'd'.repeat(64);
  assert.throws(() => validateSceneReferences(d, manifests), /artwork identity changed/);
  assert.deepEqual(await store.read(d.id), original);
});

test('large accepted contours survive transactional history and scene-store reopen', async (t) => {
  const { EditorHistory } = await import('../../src/editor/model');
  const { SceneStore } = await import('../../tools/scene/scene-editor-store');
  const directory = await temporaryDirectory(t, 'ground-contract-');

  const d = sceneFixture('graveyard');
  d.floor.layout = 'artwork';
  d.groundInteraction = ground();
  d.groundInteraction.regions[0]!.mask![0]!.outer = Array.from(
    { length: 90000 },
    (_, i) =>
      [
        0.5 + 0.2 * Math.cos((i / 90000) * Math.PI * 2),
        0.5 + 0.2 * Math.sin((i / 90000) * Math.PI * 2),
      ] as [number, number],
  );
  assert.ok(Buffer.byteLength(JSON.stringify(d)) > 1024 * 1024);
  const history = new EditorHistory(d);
  history.change((p) => {
    p.groundInteraction!.regions[0]!.name = 'Accepted correction';
  });
  history.undo();
  assert.equal(history.document.groundInteraction!.regions[0]!.name, 'Tree');
  history.redo();
  const store = new SceneStore(directory);
  await store.save(history.document, null);
  const reopened = await store.read(d.id);
  assert.deepEqual(reopened.document, history.document);
  const recovery = JSON.stringify({ document: history.document });
  assert.deepEqual(parseSceneDocument(JSON.parse(recovery).document), history.document);
});

test('placement rejects painted silhouettes and collision with base clearance, preserves holes and canopy walking', () => {
  const d = emptyScene();
  d.floor.layout = 'artwork';
  d.groundInteraction = ground();
  delete d.groundInteraction.regions[0]!.footprint;
  const layout = artworkFloorLayout(d.floor.width, d.floor.depth);
  const masked = layout.world([0.3, 0.3]),
    hole = layout.world([0.5, 0.5]);
  const scene = resolveScene(d),
    policy = groundPlacementPolicy(scene.document, scene.area);
  assert.match(policy(masked, 0.3)!, /Tree/);
  assert.equal(policy(hole, 0.3), undefined);
  assert.match(policy(layout.world([0.405, 0.5]), 0.3)!, /Tree/);
  assert.equal(new Navigation(scene.area).route(masked, hole, 0.3).status, 'ready');
  d.objects.push({ id: 'barrel', kind: 'prop', asset: 'ink-scenery', clip: 'barrel', ...masked });
  assert.doesNotThrow(() => resolveScene(d), 'Scenery may be tucked behind painted foliage');
  d.gameplay!.interactables = [
    {
      id: 'supply',
      object: 'barrel',
      kind: 'container',
      ...masked,
      guards: [],
      rewards: [],
      idle: 'barrel',
      action: 'barrel',
      spent: 'barrel',
    },
  ];
  assert.throws(
    () => resolveScene(d),
    /barrel: base overlaps painted scenery/,
    'Gameplay targets must begin visible',
  );
  d.gameplay!.interactables = [];
  d.objects[0]!.role = 'ground';
  assert.doesNotThrow(() => resolveScene(d), 'Ground overlays are intentional artwork');
  d.objects = [];
  d.gameplay!.spawns.push({ id: 'guard', actor: 'skeleton', ...masked });
  assert.throws(() => resolveScene(d), /guard: base overlaps painted scenery/);
  d.gameplay!.spawns = [{ id: 'jittering-guard', actor: 'skeleton', ...hole, jitterZ: 4 }];
  assert.throws(() => resolveScene(d), /jittering-guard: base overlaps painted scenery/);
  d.gameplay!.spawns = [];
  const collision = layout.world([0.1, 0.1]);
  d.groundInteraction.regions.push({
    id: 'rock',
    name: 'Rock',
    footprint: [
      { x: collision.x - 0.2, z: collision.z - 0.2 },
      { x: collision.x + 0.2, z: collision.z - 0.2 },
      { x: collision.x + 0.2, z: collision.z + 0.2 },
      { x: collision.x - 0.2, z: collision.z + 0.2 },
    ],
  });
  d.objects.push({
    id: 'supply',
    kind: 'prop',
    asset: 'ink-scenery',
    clip: 'barrel',
    ...collision,
  });
  assert.throws(() => resolveScene(d), /supply: base overlaps painted collision/);
});
