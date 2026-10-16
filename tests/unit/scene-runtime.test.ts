import { interactable } from '../fixtures/world';
import { onExit } from '../../tools/scope-exit';
import { RoomPresentation } from '../../src/presentation/room-presentation';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GameSession } from '../../src/core/session';
import { Simulation } from '../../src/core/simulation';
import { makeCamera } from '../../src/presentation/camera';
import { composeDraftGameplay } from '../../src/content/draft-gameplay';
import { emptyScene } from '../../src/editor/default-scene';
import { EditorHistory } from '../../src/editor/model';
import { EditorView } from '../../src/editor/view';
import { setCutoutOpacity } from '../../src/presentation/sprite';
import { InkRoom } from '../../src/presentation/ink-room';
import { ContentRegistry, heightAt } from '../../src/content/world';
import { content, contentDefinitions } from '../fixtures/content';
import { manifestFixture } from '../fixtures/manifest';
import type { PreparedRegistration } from '../../src/assets/registration';
import type { AssetPack, AssetRuntime } from '../../src/assets/loader';
import type { WorldVisualDefinition } from '../../src/content/world-visuals';

const still = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
const registration = {
  animation: { clips: {}, offsets: {}, pairs: [] },
  coverage: { masks: {}, sockets: {} },
} as unknown as PreparedRegistration;
function pack(id: string) {
  const manifest = manifestFixture(id);
  manifest.asset.clips.rest = manifest.asset.clips.idle!;
  return { manifest, textures: new Map([['atlas-0', new T.Texture()]]) };
}

test('untextured diagnostics render terrain but require explicit visuals for scenery and exits', () => {
  const area = { ...content.area('court'), props: [], exits: [] };
  const texture = new T.CanvasTexture({} as HTMLCanvasElement);
  const room = new RoomPresentation(new Map(), makeCamera(1), texture, registration);
  using _scopeExit1 = onExit(() => {
    room.disposeScenery();
    room.disposeResources();
    texture.dispose();
  });
  room.buildRoom(area, undefined);
  assert.equal(room.inkRoom, undefined);
  assert.equal(room.room.children.length, 2, 'Diagnostic terrain and grid remain available');
  for (const fields of [
    { props: content.area('court').props },
    { exits: content.area('court').exits },
  ])
    assert.throws(
      () => room.buildRoom({ ...area, ...fields }, undefined),
      /authored visual definition/,
    );
});

test('room build failure releases the unattached grid and can rebuild cleanly', (t) => {
  const area = { ...content.area('court'), props: [], exits: [] },
    texture = new T.CanvasTexture({} as HTMLCanvasElement),
    room = new RoomPresentation(new Map(), makeCamera(1), texture, registration),
    destroyed = new Set<object>();
  for (const prototype of [T.BufferGeometry.prototype, T.Material.prototype]) {
    const dispose = prototype.dispose;
    t.mock.method(prototype, 'dispose', function (this: T.BufferGeometry | T.Material) {
      destroyed.add(this);
      dispose.call(this);
    });
  }
  const add = room.room.add.bind(room.room);
  room.room.add = function (...objects) {
    if (objects.some((object) => object instanceof T.LineSegments))
      throw new Error('grid attachment failed');
    return add(...objects);
  };
  try {
    assert.throws(() => room.buildRoom(area, undefined), /grid attachment failed/);
    assert.equal(room.room.children.length, 0);
    assert.equal(destroyed.size, 4, 'floor and grid geometry/material share construction cleanup');
    room.room.add = add;
    room.buildRoom(area, undefined);
    assert.equal(room.room.children.length, 2);
    room.disposeResources();
    assert.equal(destroyed.size, 8);
  } finally {
    room.disposeScenery();
    room.disposeResources();
    texture.dispose();
  }
});

test('failed scenery construction releases contact shadows before room ownership transfers', (t) => {
  const area = { ...content.area('court'), props: [], exits: [] },
    texture = new T.CanvasTexture({} as HTMLCanvasElement),
    room = new RoomPresentation(new Map(), makeCamera(1), texture, registration),
    destroyed = new Set<object>();
  for (const prototype of [T.BufferGeometry.prototype, T.Material.prototype]) {
    const dispose = prototype.dispose;
    t.mock.method(prototype, 'dispose', function (this: T.BufferGeometry | T.Material) {
      destroyed.add(this);
      dispose.call(this);
    });
  }
  const add = room.room.add.bind(room.room);
  room.room.add = function (...objects) {
    add(...objects);
    throw new Error('contact attachment failed');
  };
  try {
    assert.throws(() => room.buildRoom(area, fixtureArt()), /contact attachment failed/);
    assert.equal(room.inkRoom, undefined);
    assert.equal(room.room.children.length, 0);
    assert.equal(destroyed.size, 2, 'staged contact geometry and material must be destroyed');
    room.room.add = add;
    room.buildRoom(area, undefined);
    assert.equal(room.room.children.length, 2, 'a failed scenery constructor permits retry');
  } finally {
    room.disposeScenery();
    room.disposeResources();
    texture.dispose();
  }
});

test('checkpoint restore preserves the next alternating sword attack', () => {
  const session = new GameSession(content);
  session.step({ ...still, attack: true });
  const save = session.captureSave();
  session.restoreSave(save);
  session.step({ ...still, attack: true });
  assert.equal(session.sim.hero.attackKind, 'lunge');
  // Older prototype saves without the new optional field remain loadable.
  delete save.player.nextAttack;
  session.restoreSave(save);
  session.step({ ...still, attack: true });
  assert.equal(session.sim.hero.attackKind, 'sweep');
});

test('draft death retries at the authored hero start', () => {
  const draft = emptyScene();
  draft.hero = { x: 3, z: 2 };
  const { registry } = composeDraftGameplay(draft, contentDefinitions, {});
  const session = new GameSession(registry);
  assert.deepEqual([session.sim.hero.x, session.sim.hero.z], [3, 2]);
  session.sim.hero.health = 0;
  session.sim.hero.age = 10000;
  session.step(still);
  assert.deepEqual([session.sim.hero.x, session.sim.hero.z], [3, 2]);
});

function scenery(opacity: number, tint: number, fade: boolean, interior: boolean) {
  const prepared = pack('scenery');
  const art: WorldVisualDefinition = {
    floor: 'scenery',
    camera: emptyScene().camera,
    props: [
      {
        purpose: 'Regression scenery',
        id: 'prop',
        asset: 'scenery',
        clip: 'idle',
        x: 0,
        z: 0,
        opacity,
        tint,
        fade,
      },
    ],
    decals: [],
    walls: [],
    paths: [],
    graves: [],
    proceduralAssets: [],
    ...(interior ? { interior: content.area('court').bounds } : {}),
  };
  const room = new InkRoom(
    content.area('court'),
    new Map([['scenery', prepared]]),
    new T.Group(),
    makeCamera(1),
    undefined,
    registration,
    art,
  );
  room.build();
  return room;
}

test('authored upright opacity survives both outdoor reveal and interior fade updates', () => {
  for (const interior of [false, true])
    for (const fade of [false, true]) {
      const room = scenery(0.4, 0xffffff, fade, interior);
      using _cleanup4 = onExit(() => room.dispose());
      const sprite = room.sprites[0]!;
      assert.equal(sprite.material.opacity, 0.4);
      assert.equal(sprite.material.transparent, true);
      assert.equal(sprite.material.depthWrite, false);
      const sim = new Simulation(content);
      room.update(sim, 1, true, 1000);
      assert.equal(sprite.material.opacity, 0.4);
    }
});

test('black is an accepted upright scenery tint', () => {
  const room = scenery(1, 0, false, false);
  using _cleanup1 = onExit(() => room.dispose());
  assert.equal(room.sprites[0]!.material.color.getHex(), 0);
});

test('placed sprites retain their authored occlusion roots without mesh metadata', () => {
  const room = scenery(1, 0xffffff, false, false),
    roots: unknown[] = [];
  using _cleanup3 = onExit(() => room.dispose());
  room.occlude({
    attach() {},
    update(sprite, x, z) {
      roots.push([sprite.id, x, z]);
    },
  });
  assert.deepEqual(roots, [['prop', 0, 0]]);
});

test('external arrangements cannot inherit an unrelated health reward through matching object IDs', () => {
  const draft = emptyScene();
  draft.objects = [{ id: 'potion', kind: 'prop', asset: 'scenery', clip: 'idle', x: 0, z: 0 }];
  draft.gameplay!.pickups = [
    { id: 'health', object: 'potion', kind: 'health', amount: 25, radius: 1, x: 0, z: 0 },
  ];
  const history = new EditorHistory(draft);
  history.insertFragment([
    { id: 'potion', kind: 'prop', asset: 'other-art', clip: 'idle', x: 3, z: 0 },
  ]);
  assert.equal(history.document.gameplay!.pickups.length, 1);
  const { registry } = composeDraftGameplay(history.document, contentDefinitions, {});
  const sim = new Simulation(registry);
  Object.assign(sim.hero, { x: 3, z: 0, health: 50 });
  sim.step(still);
  assert.equal(sim.hero.health, 50, 'Imported scenery must not heal the player');
  history.duplicateMany(['potion']);
  assert.equal(history.document.gameplay!.pickups.length, 2);
});

function roomFixture(
  prepared: AssetPack,
  art: WorldVisualDefinition,
  sim = new Simulation(content),
) {
  const group = new T.Group();
  const room = new InkRoom(
    sim.areaDefinition,
    new Map([[prepared.manifest.asset.id, prepared]]),
    group,
    makeCamera(1),
    new T.Texture(),
    registration,
    art,
  );
  room.build();
  return { room, group, sim };
}
function fixtureArt(): WorldVisualDefinition {
  return {
    floor: 'scenery',
    camera: emptyScene().camera,
    props: [],
    decals: [],
    walls: [],
    paths: [],
    graves: [],
    proceduralAssets: [],
    interior: content.area('court').bounds,
  };
}
function animatedPack() {
  const prepared = pack('scenery');
  const first = prepared.manifest.frames[0]!;
  prepared.manifest.frames.push({ ...structuredClone(first), id: 'second-frame' });
  prepared.manifest.asset.clips.idle!.d45 = {
    frames: [first.id, 'second-frame'],
    durationsMs: [100, 100],
    loop: true,
    notifies: [],
  };
  return prepared;
}

test('interactive scenery retains its authored pose while idle, claimed and restored', () => {
  const prepared = animatedPack();
  const definitions = structuredClone(contentDefinitions);
  const area = definitions.areas.find((area) => area.id === 'court')!;
  area.interactables = [
    interactable({ id: 'container', object: 'prop', x: 1, z: 1, action: 'idle', spent: 'idle' }),
  ];
  const sim = new Simulation(new ContentRegistry(definitions));
  const art = fixtureArt();
  art.props = [
    {
      id: 'prop',
      asset: 'scenery',
      clip: 'idle',
      x: 1,
      z: 1,
      y: 0.8,
      rotation: 0.4,
      scale: 0.7,
      mirror: true,
      purpose: 'Interactive scenery',
    },
  ];
  const { room } = roomFixture(prepared, art, sim);
  using _cleanup9 = onExit(() => room.dispose());
  const sprite = room.sprites[0]!;
  const position = sprite.mesh.position.clone();
  const quaternion = sprite.mesh.quaternion.clone();
  const scale = sprite.mesh.scale.clone();
  for (const state of ['idle', 'claimed', 'restored']) {
    if (state === 'claimed') {
      Object.assign(sim.hero, { x: 1, z: 1 });
      assert.equal(sim.openContainer('container'), true);
      sim.drops = [];
    } else if (state === 'restored') sim.objectActions.clear();
    room.update(sim.view, 1, true, 0);
    assert.deepEqual(sprite.mesh.position, position, state + ' position');
    assert.deepEqual(sprite.mesh.quaternion.toArray(), quaternion.toArray(), state + ' rotation');
    assert.deepEqual(sprite.mesh.scale, scale, state + ' scale');
  }
});

test('editor visibility preserves completed effect hiding before rendering', () => {
  const prepared = animatedPack();
  prepared.manifest.asset.type = 'effect';
  Object.assign(prepared.manifest.asset.clips.idle!.d45!, { loop: false, endBehavior: 'hide' });
  const art = fixtureArt();
  art.props = [
    { id: 'effect', asset: 'scenery', clip: 'idle', x: 0, z: 0, purpose: 'One-shot effect' },
  ];
  const { room, sim } = roomFixture(prepared, art);
  const view = new EditorView({} as HTMLCanvasElement, {} as AssetRuntime);
  const submitted: boolean[] = [];
  const presentation = {
    roomPresentation: { inkRoom: room },
    beforeRender() {},
    update(_sim: Simulation, alpha: number, ms: number) {
      room.update(sim, alpha, true, ms);
      this.beforeRender();
      submitted.push(room.sprites[0]!.mesh.visible);
    },
  };
  Object.assign(view, { renderer: presentation, simulation: sim, accepted: true });
  using _cleanup6 = onExit(() => room.dispose());
  view.render(250);
  assert.deepEqual(submitted, [false], 'A completed effect stays hidden in the submitted frame');
  room.replay();
  view.setEditingVisibility(new Set(['effect']));
  view.render(50);
  assert.equal(submitted.at(-1), false, 'Editor hiding still overrides a playing effect');
  view.setEditingVisibility(new Set());
  view.render(0);
  assert.equal(submitted.at(-1), true, 'Showing a playing effect restores its visibility');
});

test('placed effects retain alpha blending at full opacity and after an occlusion fade', () => {
  const prepared = pack('scenery');
  prepared.manifest.asset.type = 'effect';
  const art = fixtureArt();
  art.props = [
    { id: 'effect', asset: 'scenery', clip: 'idle', x: 0, z: 0, purpose: 'Effect', fade: true },
  ];
  const { room, sim } = roomFixture(prepared, art);
  using _cleanup5 = onExit(() => room.dispose());
  assert.equal(room.sprites[0]!.material.transparent, true);
  assert.equal(room.sprites[0]!.material.depthWrite, false);
  setCutoutOpacity(room.sprites[0]!.material, 0.18);
  setCutoutOpacity(room.sprites[0]!.material, 1);
  room.update(sim, 1, true, 1000);
  assert.equal(room.sprites[0]!.material.transparent, true);
  assert.equal(room.sprites[0]!.material.depthWrite, false);
});

test('collected pickups hide their artwork and shadows on every frame', () => {
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.pickups = [
    { id: 'health', object: 'potion', kind: 'health', amount: 25, radius: 1, x: 0, z: 0 },
  ];
  const sim = new Simulation(new ContentRegistry(definitions));
  Object.assign(sim.hero, { x: 0, z: 0, health: 50 });
  sim.enemies.forEach((a) => (a.stun = 1000));
  sim.step(still);
  assert.equal(sim.hero.health, 75);
  const art = fixtureArt();
  art.props = [
    {
      id: 'potion',
      asset: 'scenery',
      clip: 'idle',
      x: 0,
      z: 0,
      purpose: 'Pickup',
      footprint: [0.2, 0.2],
    },
  ];
  for (const prepared of [pack('scenery'), animatedPack()]) {
    const { room, group } = roomFixture(prepared, art, sim);
    using _cleanup8 = onExit(() => room.dispose());
    assert.ok(group.children.length > 1, 'Fixture includes a pickup shadow');
    for (let i = 0; i < 3; i++) {
      room.update(sim.view, 1, true, 100);
      room.contactShadows!.update();
      assert.equal(room.contactShadows!.mesh.geometry.getAttribute('contactOpacity').getX(0), 0);
      assert.ok(
        group.children
          .filter((m) => m !== room.sprites[0]!.mesh && m !== room.contactShadows!.mesh)
          .every((m) => !m.visible),
      );
      assert.equal(room.sprites[0]!.mesh.visible, false);
    }
  }
});

test('animated ground details conform to ramps after changing drawings', () => {
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.surface = {
    kind: 'ramp',
    axis: 'x',
    start: -4,
    end: 4,
    startHeight: 0,
    endHeight: 4,
  };
  const sim = new Simulation(new ContentRegistry(definitions));
  const prepared = animatedPack();
  prepared.manifest.asset.projection = 'top-down';
  const art = fixtureArt();
  art.decals = [
    {
      id: 'ground-detail',
      asset: 'scenery',
      clip: 'idle',
      x: 0,
      z: 0,
      purpose: 'Ground detail',
      scale: 2,
      rotation: 0.3,
      mirror: true,
    },
  ];
  const { room } = roomFixture(prepared, art, sim);
  using _cleanup7 = onExit(() => room.dispose());
  room.update(sim, 1, true, 150);
  const sprite = room.sprites[0]!;
  assert.equal(sprite.animator.frame, 'second-frame');
  sprite.mesh.updateMatrixWorld(true);
  const positions = sprite.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const p = new T.Vector3()
      .fromBufferAttribute(positions, i)
      .applyMatrix4(sprite.mesh.matrixWorld);
    assert.ok(Math.abs(p.y - heightAt(sim.areaDefinition, p.x, p.z) - 0.018) < 1e-6);
  }
});

test('static tinted ground details color both the solid drawing and its soft edge', () => {
  const prepared = pack('scenery');
  prepared.manifest.asset.renderStyle = 'clean-ink';
  prepared.manifest.asset.projection = 'top-down';
  const art = fixtureArt();
  art.decals = [
    {
      id: 'ground-detail',
      asset: 'scenery',
      clip: 'idle',
      x: 0,
      z: 0,
      purpose: 'Tinted detail',
      tint: 0x223344,
    },
  ];
  const { room } = roomFixture(prepared, art);
  using _cleanup2 = onExit(() => room.dispose());
  const sprite = room.sprites[0]!;
  assert.equal(sprite.material.color.getHex(), 0x223344);
  assert.equal(sprite.edgeMaterial!.color.getHex(), 0x223344);
});

test('artwork with several health rewards stays visible until every reward is taken', () => {
  const room = scenery(1, 0xffffff, false, false);
  using cleanup = onExit(() => room.dispose());
  const definitions = structuredClone(contentDefinitions);
  const area = definitions.areas[0]!;
  area.pickups = [
    { id: 'small', object: 'prop', kind: 'health', amount: 20, radius: 0.4, x: 0, z: 0 },
    { id: 'wide', object: 'prop', kind: 'health', amount: 20, radius: 1, x: 0, z: 0 },
  ];
  const sim = new Simulation(new ContentRegistry(definitions));
  // The wider pickup can be taken before entering the smaller pickup's radius.
  Object.assign(sim.hero, { x: 0.8, z: 0, health: 80 });
  sim.step();
  assert.deepEqual([...sim.collectedPickups], ['wide']);
  Object.assign(room, { area: sim.areaDefinition });
  room.update(sim.view, 1, true);
  assert.equal(room.sprites[0]!.mesh.visible, true);
  sim.collectedPickups.add('small');
  room.update(sim.view, 1, true);
  assert.equal(room.sprites[0]!.mesh.visible, false);
});

test('completed breakable animations honor their hide ending after play and restore', () => {
  const prepared = animatedPack();
  Object.assign(prepared.manifest.asset.clips.idle!.d45!, { loop: false, endBehavior: 'hide' });
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.interactables = [
    interactable({ id: 'crate', object: 'prop', kind: 'breakable', action: 'idle', spent: 'idle' }),
  ];
  const sim = new Simulation(new ContentRegistry(definitions));
  const art = fixtureArt();
  art.props = [{ id: 'prop', asset: 'scenery', clip: 'idle', x: 0, z: 0, purpose: 'Breakable' }];
  const { room } = roomFixture(prepared, art, sim);
  using cleanup = onExit(() => room.dispose());
  sim.claimedObjects.add('crate');
  sim.objectActions.set('crate', 0);
  room.update(sim.view, 0, true);
  assert.equal(room.sprites[0]!.mesh.visible, true, 'the action remains visible while playing');
  sim.tick = 12;
  room.update(sim.view, 1, true);
  assert.equal(room.sprites[0]!.mesh.visible, false, 'the terminal drawing must disappear');
  sim.objectActions.clear();
  room.update(sim.view, 1, true);
  assert.equal(room.sprites[0]!.mesh.visible, false, 'loading cannot revive spent artwork');
});
