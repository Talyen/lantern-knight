import { interactable } from '../fixtures/world';
import { mockGlobals } from '../fixtures/globals';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorHistory, sceneItems } from '../../src/editor/model';
import { sceneArtFindings } from '../../src/content/scene-art-validation';
import { resolveAuthoredScene } from '../../src/content/world-art';
import { ContentRegistry } from '../../src/content/world';
import { composeDraftGameplay } from '../../src/content/draft-gameplay';
import { emptyScene } from '../../src/editor/default-scene';
function assembly() {
  const d = emptyScene();
  d.objects = [
    { id: 'support', kind: 'prop', asset: 'ink-scenery', clip: 'offering-table', x: 0, z: 0 },
    {
      id: 'child',
      kind: 'prop',
      asset: 'ink-scenery',
      clip: 'lantern',
      role: 'attachment',
      mount: { to: 'support', offset: [1, 0, 0] },
    },
    { id: 'other', kind: 'prop', asset: 'ink-scenery', clip: 'urn-niche', x: 4, z: 0 },
  ];
  return EditorHistory.create(d);
}
it('history rejects broken attachments before accepting them as editable state', () => {
  const d = parseSceneDocument(assembly().document);
  d.objects[1]!.mount!.to = 'missing';
  assert.throws(() => EditorHistory.create(d), /Missing attachment support/);
  d.objects[1]!.mount!.to = 'child';
  assert.throws(() => EditorHistory.create(d), /Cyclic attachment support/);
});

it('absolute alignment places selected supports before attachments regardless of selection order', () => {
  for (const selection of [
    ['child', 'support'],
    ['support', 'child'],
  ]) {
    const history = assembly();
    history.change((d) => {
      d.objects.pop();
      d.objects[1]!.footprint = [0.2, 0.2];
      d.geometry = {
        bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 },
        surface: { kind: 'flat', height: 0 },
        baselineEntry: 'start',
        entries: [{ id: 'start', x: 4, z: 2 }],
      };
    });
    const before = history.document;
    history.transformEach(selection, { x: 3, z: 2 });
    const selected = sceneItems(history.document).filter((item) =>
      selection.includes(item.placement.id),
    );
    assert.ok(selected.every((item) => item.placement.x === 3 && item.placement.z === 2));
    const aligned = history.document;
    assert.throws(() => history.transformEach(selection, { x: 4, z: 2 }), /entry is obstructed/);
    assert.equal(history.document, aligned);
    history.undo();
    assert.deepEqual(history.document, before);
  }
});

it('batch transforms commit once, use a shared pivot, and preserve selected attachments', () => {
  const h = assembly(),
    before = structuredClone(h.document);
  h.transformMany(['support', 'child', 'other'], { rotation: Math.PI / 2, scale: 2 });
  const items = sceneItems(h.document).map((p) => p.placement);
  assert.ok(Math.abs(items[0]!.x - items[1]!.x) < 1e-9);
  assert.ok(Math.abs(items[1]!.z - items[0]!.z - 2) < 1e-9);
  h.undo();
  assert.deepEqual(h.document, before);
  assert.equal(h.canUndo, false);
  h.redo();
  assert.notDeepEqual(h.document, before);
  const valid = structuredClone(h.document);
  assert.throws(() => h.transformMany(['support', 'other'], { scale: 100 }));
  assert.deepEqual(h.document, valid);
});
it('assembly duplication remaps children once and deletion removes dependent children in one undo', () => {
  const h = assembly();
  const ids = h.duplicateMany(['support', 'child']);
  assert.equal(ids.length, 2);
  const parent = h.document.objects.find((p) => p.id === ids[0])!,
    child = h.document.objects.find((p) => p.id === ids[1])!;
  assert.equal(child.mount!.to, parent.id);
  assert.equal(parent.x, 0.5);
  assert.deepEqual(child.mount!.offset, [1, 0, 0]);
  h.undo();
  assert.equal(h.document.objects.length, 3);
  h.redo();
  h.removeMany([parent.id]);
  assert.equal(h.document.objects.length, 3);
  h.undo();
  assert.equal(h.document.objects.length, 5);
});
it('fragments detach external supports while keeping world placement and insert independent identities', () => {
  const h = assembly();
  const fragment = h.fragment(['child']);
  assert.equal(fragment[0]!.mount, undefined);
  assert.equal(fragment[0]!.x, 1);
  const ids = h.insertFragment(fragment);
  assert.notEqual(ids[0], 'child');
  assert.equal(h.document.objects.at(-1)!.x, 1);
});

it('copied and saved assemblies preserve draw order and undo as one edit', () => {
  const h = assembly();
  h.change((d) => {
    d.propOrder = ['child', 'support'];
  });
  const before = h.document;
  for (const insert of [
    () => h.insertFragment(h.fragment(['support'])),
    () => h.duplicateMany(['support']),
  ]) {
    const ids = insert();
    assert.deepEqual(
      sceneItems(h.document)
        .filter((p) => ids.includes(p.placement.id))
        .map((p) => (p.placement.mount ? 'child' : 'support')),
      ['child', 'support'],
    );
    h.undo();
    assert.equal(h.document, before);
  }
});

it('duplicating artwork preserves every health reward attached to it', () => {
  const d = emptyScene();
  d.objects = [{ id: 'potion', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 0, z: 0 }];
  d.gameplay!.pickups = [10, 20].map((amount, i) => ({
    id: 'health-' + i,
    object: 'potion',
    kind: 'health',
    amount,
    radius: 0.5,
    x: 0,
    z: 0,
  }));
  const h = EditorHistory.create(d);
  const [copy] = h.duplicateMany(['potion']);
  const rewards = h.document.gameplay!.pickups.filter((p) => p.object === copy);
  assert.deepEqual(
    rewards.map((p) => p.amount),
    [10, 20],
  );
  const { registry } = composeDraftGameplay(h.document, content.definitions, {});
  const sim = new Simulation(registry);
  Object.assign(sim.hero, { x: 0.5, z: 0.5, health: 50 });
  sim.step({ move: { x: 0, z: 0 }, aim: { x: 1, z: 0.5 } });
  assert.equal(sim.hero.health, 80);
});

import { SceneLibrary, patternPoints } from '../../src/editor/library';
import { parseSceneFragment, parseSceneDocument } from '../../src/content/scene-document';
it('patterns are reproducible, bounded, and follow authored path endpoints', () => {
  const d = emptyScene();
  d.paths = [
    {
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 4 },
      ],
      width: 1,
    },
  ];
  assert.deepEqual(patternPoints(d, 'path', 3, 1, 2), [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 4 },
  ]);
  d.paths.push({
    points: [
      { x: 10, z: 10 },
      { x: 12, z: 10 },
    ],
    width: 1,
  });
  assert.deepEqual(patternPoints(d, 'path', 2, 1, 2, { pathIndex: 1 }), [
    { x: 10, z: 10 },
    { x: 12, z: 10 },
  ]);
  assert.throws(() => patternPoints(d, 'path', 2, 1, 2, { pathIndex: 3 }));
  assert.deepEqual(
    patternPoints(d, 'path', 2, NaN, 0, { pathIndex: 1 }),
    [
      { x: 10, z: 10 },
      { x: 12, z: 10 },
    ],
    'hidden scatter inputs must not prevent path placement',
  );
  const shifted = patternPoints(d, 'scatter', 10, 142, 2, { center: { x: 8, z: -3 } });
  assert.ok(shifted.every((p) => Math.hypot(p.x - 8, p.z + 3) <= 2));
  const points = patternPoints(d, 'scatter', 10, 142, 2);
  assert.deepEqual(points, patternPoints(d, 'scatter', 10, 142, 2));
  assert.ok(points.every((p) => Math.hypot(p.x, p.z) <= 2));
  assert.throws(() => patternPoints(d, 'scatter', 51, 142, 2));
  assert.throws(() =>
    parseSceneFragment({
      version: 1,
      name: 'Broken',
      objects: [
        {
          id: 'child',
          kind: 'prop',
          asset: 'ink-scenery',
          clip: 'lantern',
          role: 'attachment',
          mount: { to: 'missing', offset: [0, 0, 0] },
        },
      ],
    }),
  );
});

import { EditorView } from '../../src/editor/view';
import type { AssetRuntime } from '../../src/assets/loader';
import { Vector3, Quaternion, Group, Texture } from 'three';
import { makeCamera } from '../../src/presentation/camera';
import { Simulation } from '../../src/core/simulation';
import { content, contentDefinitions } from '../fixtures/content';
import { manifestFixture } from '../fixtures/manifest';

it('placement ghost retries the same asset after a transient load failure', async () => {
  let attempts = 0,
    releases = 0;
  const runtime = {
    async loadPack() {
      attempts++;
      if (attempts === 1) throw new Error('temporary failure');
      return {
        manifest: manifestFixture(),
        textures: new Map(),
        release: () => {
          releases++;
        },
      };
    },
  };
  const view = new EditorView({} as HTMLCanvasElement, runtime as unknown as AssetRuntime);
  Object.assign(view, { accepted: true });
  await assert.rejects(
    view.placementGhost('ink-hero-current', 'idle', 'd00', new Vector3()),
    /temporary failure/,
  );
  await view.placementGhost('ink-hero-current', 'idle', 'd00', new Vector3());
  assert.equal(attempts, 2);
  view.clearPlacementGhost();
  assert.equal(releases, 1);
});

it('placement ghost releases rejected clips and can retry the same selection', async () => {
  let releases = 0;
  const manifest = manifestFixture();
  const runtime = {
    async loadPack() {
      return { manifest, textures: new Map(), release: () => releases++ };
    },
  };
  const view = new EditorView({} as HTMLCanvasElement, runtime as unknown as AssetRuntime);
  Object.assign(view, { accepted: true });
  await assert.rejects(
    view.placementGhost('ink-hero-current', 'missing', 'd00', new Vector3()),
    /clip unavailable/,
  );
  assert.equal(releases, 1);
  await assert.rejects(
    view.placementGhost('ink-hero-current', 'missing', 'd00', new Vector3()),
    /clip unavailable/,
  );
  assert.equal(releases, 2);
  view.clearPlacementGhost();
  assert.equal(releases, 2);
});

it('placement ghost uses the latest cursor position after loading', async () => {
  const { promise: loaded, resolve: complete } =
    Promise.withResolvers<Awaited<ReturnType<AssetRuntime['loadPack']>>>();
  const runtime = { loadPack: () => loaded };
  const view = new EditorView({} as HTMLCanvasElement, runtime as unknown as AssetRuntime);
  Object.assign(view, {
    accepted: true,
    renderer: { overlay: new Group(), camera: makeCamera(1), update() {} },
    simulation: new Simulation(content),
  });
  const pending = view.placementGhost('ink-hero-current', 'idle', 'd00', new Vector3(1, 0, 1));
  await view.placementGhost('ink-hero-current', 'idle', 'd00', new Vector3(3, 0, 4));
  complete({
    manifest: manifestFixture(),
    textures: new Map([['atlas-0', new Texture()]]),
    release() {},
  });
  await pending;
  const ghost = (view as unknown as { ghost: { mesh: { position: Vector3 } } }).ghost;
  assert.equal(ghost.mesh.position.x, 3);
  assert.equal(ghost.mesh.position.z, 4);
  view.clearPlacementGhost();
});

it('editor applies transform previews before submitting the rendered frame', () => {
  const view = new EditorView({} as HTMLCanvasElement, {} as AssetRuntime);
  const mesh = {
    position: new Vector3(),
    scale: new Vector3(1, 1, 1),
    quaternion: new Quaternion(),
  };
  const sprite = { id: 'prop', mesh };
  let renderedX = -1;
  const presentation = {
    beforeRender: () => {},
    update() {
      mesh.position.set(0, 0, 0); // Shared scene update restores the accepted placement.
      this.beforeRender();
      renderedX = mesh.position.x;
    },
    roomPresentation: { inkRoom: { sprites: [sprite] } },
  };
  Object.assign(view, {
    renderer: presentation,
    simulation: new Simulation(content),
    accepted: true,
  });
  const accepted = emptyScene();
  accepted.objects = [
    { id: 'prop', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 0, z: 0 },
  ];
  const internals = view as unknown as { appliedDocument: typeof accepted };
  internals.appliedDocument = accepted;
  const preview = structuredClone(accepted);
  preview.objects[0]!.x = 3;
  view.previewTransforms(preview);
  assert.equal(renderedX, 3);
  view.clearTransformPreview();
  view.previewPosition('prop', 4, 0);
  view.render();
  assert.equal(renderedX, 4, 'canvas drag previews survive the shared scene update');
  view.clearTransformPreview();
  view.render();
  assert.equal(renderedX, 0);
});

it('scaling an assembly scales its attachment height with its support', () => {
  const h = assembly();
  h.change((d) => {
    d.objects[1]!.mount!.offset[1] = 1;
  });
  h.transformMany(['support'], { scale: 2 });
  const child = sceneItems(h.document).find((p) => p.placement.id === 'child')!.placement;
  assert.equal(child.y, 2);
  assert.equal(child.scale, 2);
});

it('duplicating an assembly preserves intentional overlap allowances between its copied objects', () => {
  const h = assembly();
  h.change((d) => {
    d.objects.find((o) => o.id === 'support')!.footprint = [2, 2];
    const other = d.objects.find((o) => o.id === 'other')!;
    other.x = 0.4;
    other.footprint = [2, 2];
    d.overlaps = [
      {
        a: 'support',
        b: 'other',
        region: { minX: -1, maxX: 2, minZ: -1, maxZ: 1 },
        reason: 'Intentional assembled join',
      },
    ];
  });
  const before = h.document;
  const [support, , other] = h.duplicateMany(['support', 'other']);
  const overlap = h.document.overlaps.find((o) => o.a === support && o.b === other);
  assert.deepEqual(overlap, {
    a: support,
    b: other,
    region: { minX: -0.5, maxX: 2.5, minZ: -0.5, maxZ: 1.5 },
    reason: 'Intentional assembled join',
  });
  assert.equal(
    sceneArtFindings(resolveAuthoredScene(h.document)).some(
      (f) =>
        f.kind === 'solid-intersection' &&
        ((f.a === support && f.b === other) || (f.a === other && f.b === support)),
    ),
    false,
  );
  h.undo();
  assert.deepEqual(h.document, before);
});

it('applying a repeat pattern preserves the copied pickups as playable health rewards', async (t) => {
  const d = emptyScene();
  d.objects = [{ id: 'potion', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 0, z: 0 }];
  d.gameplay!.pickups = [
    { id: 'health', object: 'potion', kind: 'health', amount: 25, radius: 0.5, x: 0, z: 0 },
  ];
  const h = EditorHistory.create(d);

  mockGlobals(t, {
    document: {
      getElementById: () => ({ value: '' }),
    },
  });

  const library = Object.create(SceneLibrary.prototype) as {
    host: object;
    points: { x: number; z: number }[];
    fragmentData: typeof d.objects;
    snapshot: string;
    patternSnapshot(): string;
    applyPattern(): Promise<void>;
    clearPreview(): void;
  };
  library.host = {
    history: () => h,
    selection: () => ['potion'],
    select: () => {},
    change: async (work: (candidate: typeof d) => void, committed: () => void) => {
      h.change(work);
      committed();
    },
  };
  library.points = [{ x: 3, z: 0 }];
  library.fragmentData = h.fragment(['potion']);
  library.clearPreview = () => {};
  library.snapshot = library.patternSnapshot();
  await library.applyPattern();
  assert.equal(h.document.gameplay!.pickups.length, 2);
  const { registry } = composeDraftGameplay(h.document, content.definitions, {});
  const sim = new Simulation(registry);
  Object.assign(sim.hero, { x: 3, z: 0, health: 50 });
  sim.step({ move: { x: 0, z: 0 }, aim: { x: 4, z: 0 } });
  assert.equal(sim.hero.health, 75);
});

import { CompositionTools } from '../../src/editor/composition';

it('delete confirmation cannot delete replacement document objects with reused identities', async () => {
  let history = assembly();
  let accept!: (answer: boolean) => void;
  const tools = Object.create(CompositionTools.prototype) as CompositionTools;
  Object.assign(tools, {
    lifetime: new AbortController(),
    selection: new Set(['support']),
    hidden: new Set(),
    locked: new Set(),
    host: {
      history: () => history,
      confirm: () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
      edit: async (work: (h: EditorHistory) => void, committed?: () => void) => {
        work(history);
        committed?.();
      },
      select() {},
    },
  });
  const deletion = tools.remove();
  history = assembly();
  history.transform('support', { x: 3 });
  const replacement = history.document;
  accept(true);
  await deletion;
  assert.deepEqual(history.document, replacement);
});

it('marquee selects rendered elevations and excludes descendants of hidden supports', (t) => {
  const node = {
    hidden: false,
    tabIndex: 0,
    setAttribute() {},
    classList: { contains: () => false },
  };
  mockGlobals(t, { document: { getElementById: () => node, body: node } });

  const h = assembly();
  const sim = new Simulation(content);
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.surface = { kind: 'flat', height: 2 };
  const elevated = new Simulation(new ContentRegistry(definitions));
  const tools = Object.create(CompositionTools.prototype) as CompositionTools;
  const host = {
    history: () => h,
    view: () => ({ sim: elevated, screen: (p: Vector3) => ({ x: p.x * 100, y: p.y * 100 }) }),
    select() {},
  };
  Object.assign(tools, {
    host,
    selection: new Set(),
    hidden: new Set(['support']),
    locked: new Set(),
  });
  tools.rectangle({ x: 390, y: 190 }, { x: 410, y: 210 }, false);
  assert.deepEqual([...tools.selection], ['other'], 'select the object at its rendered height');
  host.view = () => ({ sim, screen: (p: Vector3) => ({ x: p.x * 100, y: p.y * 100 }) });
  tools.rectangle({ x: -10, y: -10 }, { x: 110, y: 10 }, false);
  assert.equal(tools.selection.size, 0, 'a hidden support hides its mounted children from marquee');
});

it('duplicated containers retain independent rewards and follow their artwork through transforms', () => {
  const d = emptyScene();
  d.objects = [{ id: 'chest', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 0, z: 0 }];
  d.gameplay!.interactables = [
    interactable({
      id: 'reward',
      object: 'chest',
      rewards: [{ item: 'gold', amount: 5 }],
      idle: 'lantern',
      action: 'lantern',
      spent: 'lantern',
    }),
  ];
  const h = EditorHistory.create(d);
  const [copy] = h.duplicateMany(['chest']);
  const reward = h.document.gameplay!.interactables!.find((p) => p.object === copy)!;
  assert.notEqual(reward.id, 'reward');
  assert.deepEqual(reward.rewards, [{ item: 'gold', amount: 5 }]);
  h.transform(copy!, { x: 3, z: 2 });
  const { registry } = composeDraftGameplay(h.document, content.definitions, {});
  const resolved = registry
    .area(registry.definitions.initialArea)
    .interactables!.find((p) => p.id === reward.id)!;
  assert.equal(resolved.x, 3);
  assert.equal(resolved.z, 2);
  h.removeMany([copy!]);
  assert.equal(h.document.gameplay!.interactables!.length, 1);
  h.undo();
  assert.equal(h.document.gameplay!.interactables!.length, 2);
});

it('moving an assembled join carries its overlap allowance and retains undo', () => {
  const h = assembly();
  h.change((d) => {
    d.objects[0]!.footprint = [2, 2];
    d.objects[2]!.x = 0.4;
    d.objects[2]!.footprint = [2, 2];
    d.overlaps = [
      {
        a: 'support',
        b: 'other',
        region: { minX: -1, maxX: 2, minZ: -1, maxZ: 1 },
        reason: 'Assembled join',
      },
    ];
  });
  const before = h.document;
  h.transformMany(['support', 'other'], { x: 3, z: 2 });
  assert.equal(
    sceneArtFindings(resolveAuthoredScene(h.document)).some((f) => f.kind === 'solid-intersection'),
    false,
  );
  assert.deepEqual(h.document.overlaps[0]!.region, { minX: 2, maxX: 5, minZ: 1, maxZ: 3 });
  h.undo();
  assert.deepEqual(h.document, before);
});
