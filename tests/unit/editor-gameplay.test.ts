import { it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene } from '../../src/editor/default-scene';
import { parseSceneDocument } from '../../src/content/scene-document';
import { composeDraftGameplay, withGameplayDefaults } from '../../src/content/draft-gameplay';
import { contentDefinitions } from '../fixtures/content';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
it('blank drafts start empty, generic geometry resolves, and missing gameplay inherits a copied room', () => {
  const draft = emptyScene();
  let composed = composeDraftGameplay(draft, contentDefinitions, {});
  assert.equal(composed.registry.area(composed.registry.definitions.initialArea).spawns.length, 0);
  draft.base = 'custom-room';
  draft.geometry = {
    bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 },
    surface: { kind: 'flat', height: 0 },
    baselineEntry: 'start',
    entries: [{ id: 'start', x: 0, z: 0 }],
  };
  draft.target = 'live';
  draft.id = 'custom-live';
  composed = composeDraftGameplay(parseSceneDocument(draft), contentDefinitions, {});
  assert.equal(composed.registry.area('custom-room').name, draft.name);
  const copied = { ...emptyScene(), base: 'court' };
  delete copied.gameplay;
  assert.deepEqual(
    withGameplayDefaults(copied, contentDefinitions).gameplay!.spawns,
    contentDefinitions.areas.find((a) => a.id === 'court')!.spawns,
  );
});
it('draft gameplay rejects invalid references without altering the input', () => {
  const d = emptyScene();
  d.gameplay!.spawns = [{ id: 'enemy', actor: 'missing', x: 2, z: 0 }];
  const before = structuredClone(d);
  assert.throws(() => composeDraftGameplay(d, contentDefinitions, {}), /unknown actor/);
  assert.deepEqual(d, before);
  d.gameplay!.spawns = [];
  d.gameplay!.exits = [
    {
      id: 'exit',
      destination: 'missing',
      entry: 'start',
      requiresClear: false,
      trigger: { minX: -1, maxX: 1, minZ: -3, maxZ: -2 },
      marker: { x: 0, z: -2.5 },
    },
  ];
  assert.throws(() => composeDraftGameplay(d, contentDefinitions, {}), /unknown area/);
});
it('health pickups collect once, preserve collection across save/restore, and reset on encounter restart', () => {
  const d = emptyScene();
  d.objects = [
    { id: 'potion', kind: 'prop', asset: 'ink-ambient', clip: 'lamp_flame', x: 0, z: 0 },
  ];
  d.gameplay!.pickups = [
    { id: 'health', object: 'potion', kind: 'health', amount: 25, radius: 1, x: 0, z: 0 },
  ];
  const { registry } = composeDraftGameplay(d, contentDefinitions, {}),
    session = new GameSession(registry);
  session.sim.hero.health -= 40;
  session.step({ move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } });
  const healed = session.sim.hero.health;
  assert.equal(healed, session.sim.hero.definition.maxHealth - 15);
  assert.equal(session.sim.collectedPickups.has('health'), true);
  session.step({ move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } });
  assert.equal(session.sim.hero.health, healed);
  const saved = session.captureSave();
  session.restoreSave(saved);
  assert.equal(session.sim.collectedPickups.has('health'), true);
  const broken = structuredClone(saved);
  broken.areas[registry.definitions.initialArea]!.collectedPickups = ['unknown'];
  assert.throws(() => parseGame(broken, registry));
  session.resetCurrentArea();
  assert.equal(session.sim.collectedPickups.size, 0);
});
