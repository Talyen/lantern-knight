import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { actors } from '../../src/content/actors';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { nearbyInteraction } from '../../src/core/interaction';
const idle = { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } };
function fixture() {
  const area = (id: string): AreaDefinition => ({
    id,
    name: id,
    subtitle: '',
    bounds: { minX: -15, maxX: 15, minZ: -15, maxZ: 15 },
    surface: { kind: 'flat', height: 0 },
    baselineEntry: 'start',
    entries: [
      { id: 'start', x: -8, z: 0 },
      { id: 'fire-west', x: -8, z: 0 },
      { id: 'fire-east', x: 8, z: 0 },
    ],
    props: [],
    seedOffset: 0,
    floorColor: 0,
    campfires: [
      { id: 'west', name: 'West fire', x: -8, z: 0, safeRadius: 2, discovered: id === 'orchard' },
      { id: 'east', name: 'East fire', x: 8, z: 0, safeRadius: 2 },
    ],
    spawns: [
      {
        id: 'first',
        actor: 'skeleton',
        x: -3,
        z: 0,
        awareness: { radius: 2, leash: 4 },
        rewards: [
          { item: 'health-potion', amount: 1 },
          { item: 'damaged-axe', amount: 1 },
        ],
      },
      { id: 'guard', actor: 'skeleton', x: 4, z: 4, awareness: { radius: 2, leash: 4 } },
    ],
    exits: [
      {
        id: 'depart',
        explicit: true,
        trigger: { minX: 10, maxX: 12, minZ: -1, maxZ: 1 },
        marker: { x: 11, z: 0 },
        destination: id === 'orchard' ? 'forest' : 'orchard',
        entry: 'start',
        requiresClear: false,
        guards: ['guard'],
      },
    ],
    interactables: [
      {
        id: 'crate',
        object: 'crate',
        kind: 'breakable',
        x: -7,
        z: 0,
        guards: [],
        rewards: [{ item: 'gold', amount: 3 }],
        idle: 'idle',
        action: 'break',
        spent: 'broken',
      },
      {
        id: 'chest',
        object: 'chest',
        kind: 'container',
        x: 5,
        z: 4,
        guards: ['guard'],
        rewards: [{ item: 'orchard-ring', amount: 1 }],
        idle: 'idle',
        action: 'open',
        spent: 'opened',
      },
    ],
  });
  return new GameSession(
    new ContentRegistry({
      initialArea: 'orchard',
      player: 'lamplighter',
      actors,
      areas: [area('orchard'), area('forest')],
    }),
  );
}
test('local awareness isolates encounters and campfire sanctuary ends pursuit', () => {
  const s = fixture();
  s.step(idle);
  assert.equal(s.sim.inCombat, false);
  s.sim.hero.x = -4.5;
  s.step(idle);
  assert.equal(s.sim.inCombat, true);
  assert.equal(s.sim.enemies[1]!.state, 'idle');
  s.sim.hero.x = -8;
  s.step(idle);
  assert.equal(s.sim.inCombat, false);
  for (let i = 0; i < 180; i++) s.step(idle);
  assert.ok(s.sim.enemies[0]!.x >= -6, 'enemy stays outside sanctuary');
});
test('sword breaks an object once, guards protect containers and departure, explicit exits do not auto-travel', () => {
  const s = fixture();
  s.sim.hero.aim = Math.PI / 2;
  for (let i = 0; i < 50; i++) s.step({ ...idle, aim: { x: -6, z: 0 }, attack: i === 0 });
  assert.ok(s.sim.claimedObjects.has('crate'));
  assert.equal(s.sim.drops.length, 1);
  assert.equal(s.sim.claimObject('crate'), false);
  assert.equal(s.sim.claimObject('chest'), false);
  assert.equal(s.sim.exitAvailable('depart'), false);
  s.sim.damage(s.sim.hero, s.sim.enemies[1]!, 1000);
  assert.equal(s.sim.exitAvailable('depart'), true);
  assert.equal(s.sim.claimObject('chest'), true);
  s.sim.hero.x = 11;
  assert.equal(s.step(idle).transition, undefined);
});
test('loot, salvage and equipment persist while rest resets enemies and discards their uncollected drops', () => {
  const s = fixture();
  s.sim.claimObject('crate');
  assert.equal(s.sim.collectDrop('object-crate'), true);
  s.sim.damage(s.sim.hero, s.sim.enemies[0]!, 1000);
  s.sim.hero.x = -3;
  assert.equal(s.sim.collectDrop('enemy-first'), true);
  s.sim.hero.x = -8;
  s.step(idle);
  s.salvage('damaged-axe');
  assert.equal(s.inventory.iron, 2);
  s.inventory['orchard-ring'] = 1;
  s.equip('orchard-ring', 'ring1');
  assert.equal(s.sim.maxHealth, 110);
  assert.equal(s.sim.hero.health, 100);
  s.rest('orchard/west');
  assert.equal(s.sim.hero.health, 110);
  assert.equal(s.inventory.gold, 3);
  assert.ok(s.sim.claimedObjects.has('crate'));
  assert.equal(s.sim.enemies[0]!.health, 50);
  s.sim.damage(s.sim.hero, s.sim.enemies[0]!, 1000);
  s.rest('orchard/west');
  assert.equal(s.sim.drops.length, 0);
  const save = parseGame(s.captureSave(), s.registry);
  const loaded = fixture();
  loaded.restoreSave(save);
  assert.equal(loaded.inventory.iron, 2);
  assert.equal(loaded.sim.maxHealth, 110);
  loaded.unequip('ring1');
  assert.equal(loaded.sim.hero.health, 100);
});
test('potions never consume at full health, heal by 40, and retain a one second cooldown', () => {
  const s = fixture();
  s.inventory['health-potion'] = 3;
  s.step({ ...idle, potion: true });
  assert.equal(s.inventory['health-potion'], 3);
  s.sim.hero.health = 20;
  const used = s.step({ ...idle, potion: true });
  assert.equal(s.sim.hero.health, 60);
  assert.deepEqual(
    used.events.map((e) => e.kind),
    ['potion-used'],
  );
  s.step({ ...idle, potion: true });
  assert.equal(s.sim.hero.health, 60);
  assert.equal(s.inventory['health-potion'], 2);
  for (let i = 0; i < 59; i++) s.step(idle);
  s.step({ ...idle, potion: true });
  assert.equal(s.sim.hero.health, 100);
});
test('a hurt enemy completes recovery and returns home after the hero retreats to safety', () => {
  const s = fixture();
  const enemy = s.sim.enemies[0]!;
  s.sim.hero.x = -4;
  s.sim.damage(s.sim.hero, enemy, 1);
  assert.equal(enemy.state, 'hurt');
  s.sim.hero.x = -8;
  for (let i = 0; i < 80; i++) s.step(idle);
  assert.equal(enemy.state, 'idle');
  assert.equal(s.sim.inCombat, false);
});
test('fire travel requires discovery and proximity, preserves health, and cancellation preserves the source', () => {
  const s = fixture();
  assert.throws(() => s.prepareFireTravel('forest/west'));
  s.discovered.add('forest/west');
  s.sim.hero.health = 61;
  const plan = s.prepareFireTravel('forest/west');
  s.cancelTransition(plan);
  assert.equal(s.sim.area, 'orchard');
  assert.throws(() => s.commitTransition(plan));
  s.commitTransition(s.prepareFireTravel('forest/west'));
  assert.equal(s.sim.area, 'forest');
  assert.equal(s.sim.hero.health, 61);
  s.discoverFire('forest/west');
  s.sim.hero.x = 0;
  assert.throws(() => s.prepareFireTravel('orchard/west'));
});
test('death chooses the nearest reachable discovered fire in-stage and otherwise uses the last visited fire', () => {
  const s = fixture();
  s.discovered.add('orchard/east');
  s.sim.hero.x = 6;
  s.sim.hero.health = 0;
  assert.equal(s.respawnFire(), 'orchard/east');
  s.resetCurrentArea('death');
  assert.equal(s.sim.hero.x, 8);
  s.sim.damage(s.sim.hero, s.sim.enemies[1]!, 1000);
  s.commitTransition(s.prepareTransition('depart'));
  s.sim.hero.health = 0;
  s.lastFire = 'orchard/west';
  assert.equal(s.respawnFire(), 'orchard/west');
  s.resetCurrentArea('death');
  assert.equal(s.sim.area, 'orchard');
});
test('respawn compares walking routes around obstacles rather than straight-line distance', () => {
  const original = fixture();
  const s = new GameSession(
    new ContentRegistry({
      ...original.registry.definitions,
      areas: original.registry.definitions.areas.map((a) => ({
        ...a,
        props:
          a.id === 'orchard'
            ? [
                {
                  id: 'divider',
                  kind: 'wall' as const,
                  x: -4,
                  z: 0,
                  radius: 0.2,
                  height: 2,
                  shape: 'box' as const,
                  size: [1, 18] as const,
                  blocking: true,
                },
              ]
            : [],
      })),
    }),
  );
  s.discovered.add('orchard/east');
  s.sim.hero.x = -1;
  s.sim.hero.health = 0;
  assert.equal(s.respawnFire(), 'orchard/east');
});
test('checkpoint validation rejects invalid gear, duplicate drops, unknown claims and unearned object drops', () => {
  const s = fixture();
  s.sim.claimObject('crate');
  const saved = s.captureSave();
  assert.doesNotThrow(() => parseGame(saved, s.registry));
  for (const mutate of [
    (v: typeof saved) => {
      v.adventure!.equipment.sword = 'damaged-axe';
    },
    (v: typeof saved) => {
      v.areas.orchard!.drops!.push(v.areas.orchard!.drops![0]!);
    },
    (v: typeof saved) => {
      v.areas.orchard!.claimedObjects = [];
    },
  ]) {
    const next = structuredClone(saved);
    mutate(next);
    assert.throws(() => parseGame(next, s.registry));
  }
});
test('nearby prompts expose guarded reasons and collected loot cannot be collected twice', () => {
  const s = fixture();
  s.sim.hero.x = 5;
  s.sim.hero.z = 4;
  assert.match(nearbyInteraction(s.sim)!.blocked!, /guard/);
  s.sim.hero.x = -8;
  s.sim.hero.z = 0;
  s.sim.claimObject('crate');
  assert.equal(nearbyInteraction(s.sim)?.kind, 'drop');
  assert.equal(s.sim.collectDrop('object-crate'), true);
  assert.equal(s.sim.collectDrop('object-crate'), false);
});
