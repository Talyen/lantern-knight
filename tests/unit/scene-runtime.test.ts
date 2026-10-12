import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GameSession } from '../../src/core/session';
import { Simulation } from '../../src/core/simulation';
import { makeCamera } from '../../src/core/camera';
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
function pack(id: string): AssetPack {
  const manifest = manifestFixture(id);
  manifest.asset.clips.rest = manifest.asset.clips.idle!;
  return { manifest, textures: new Map([['atlas-0', new T.Texture()]]) };
}

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
      try {
        const sprite = room.sprites[0]!;
        assert.equal(sprite.material.opacity, 0.4);
        assert.equal(sprite.material.transparent, true);
        assert.equal(sprite.material.depthWrite, false);
        const sim = new Simulation(content);
        room.update(sim, 1, true, 1000);
        assert.equal(sprite.material.opacity, 0.4);
      } finally {
        room.dispose();
      }
    }
});

test('black is an accepted upright scenery tint', () => {
  const room = scenery(1, 0, false, false);
  try {
    assert.equal(room.sprites[0]!.material.color.getHex(), 0);
  } finally {
    room.dispose();
  }
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
  view.presentation = presentation as unknown as NonNullable<EditorView['presentation']>;
  view.sim = sim;
  try {
    view.render(250);
    assert.deepEqual(submitted, [false], 'A completed effect stays hidden in the submitted frame');
    room.replay();
    view.setEditingVisibility(new Set(['effect']));
    view.render(50);
    assert.equal(submitted.at(-1), false, 'Editor hiding still overrides a playing effect');
    view.setEditingVisibility(new Set());
    view.render(0);
    assert.equal(submitted.at(-1), true, 'Showing a playing effect restores its visibility');
  } finally {
    room.dispose();
  }
});

test('placed effects retain alpha blending at full opacity and after an occlusion fade', () => {
  const prepared = pack('scenery');
  prepared.manifest.asset.type = 'effect';
  const art = fixtureArt();
  art.props = [
    { id: 'effect', asset: 'scenery', clip: 'idle', x: 0, z: 0, purpose: 'Effect', fade: true },
  ];
  const { room, sim } = roomFixture(prepared, art);
  try {
    assert.equal(room.sprites[0]!.material.transparent, true);
    assert.equal(room.sprites[0]!.material.depthWrite, false);
    setCutoutOpacity(room.sprites[0]!.material, 0.18);
    setCutoutOpacity(room.sprites[0]!.material, 1);
    room.update(sim, 1, true, 1000);
    assert.equal(room.sprites[0]!.material.transparent, true);
    assert.equal(room.sprites[0]!.material.depthWrite, false);
  } finally {
    room.dispose();
  }
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
    try {
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
    } finally {
      room.dispose();
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
  try {
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
  } finally {
    room.dispose();
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
  try {
    const sprite = room.sprites[0]!;
    assert.equal(sprite.material.color.getHex(), 0x223344);
    assert.equal(sprite.edgeMaterial!.color.getHex(), 0x223344);
  } finally {
    room.dispose();
  }
});
