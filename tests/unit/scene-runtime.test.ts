import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GameSession } from '../../src/core/session';
import { Simulation } from '../../src/core/simulation';
import { makeCamera } from '../../src/core/camera';
import { composeDraftGameplay } from '../../src/content/draft-gameplay';
import { emptyScene } from '../../src/editor/default-scene';
import { EditorHistory } from '../../src/editor/model';
import { InkRoom } from '../../src/presentation/ink-room';
import { content, contentDefinitions } from '../fixtures/content';
import { manifestFixture } from '../fixtures/manifest';
import type { PreparedRegistration } from '../../src/assets/registration';
import type { AssetPack } from '../../src/assets/loader';
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
