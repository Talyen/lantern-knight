import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { actors } from '../../src/content/actors';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { rewardSchema } from '../../src/content/interactions';
import { nearbyInteraction } from '../../src/core/interaction';
function supply(session: GameSession, item: string, amount: number) {
  const save = session.captureSave();
  save.adventure!.inventory[item] = amount;
  session.restoreSave(save);
}
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
  supply(s, 'orchard-ring', 1);
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
  supply(s, 'health-potion', 3);
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

test('rest supersedes a pending fire journey and permits simulation to resume', () => {
  const s = fixture();
  s.discovered.add('forest/west');
  const plan = s.prepareFireTravel('forest/west');
  s.rest('orchard/west');
  assert.equal(s.loading, false);
  assert.throws(() => s.commitTransition(plan));
  const tick = s.sim.tick;
  s.step(idle);
  assert.equal(s.sim.tick, tick + 1);
});
test('reward validation rejects inherited object names', () => {
  for (const item of ['constructor', 'toString', '__proto__']) {
    assert.equal(rewardSchema.safeParse({ item, amount: 1 }).success, false);
  }
  for (const item of ['constructor', 'toString']) {
    const s = fixture(),
      save = s.captureSave();
    Object.defineProperty(save.adventure!.inventory, item, { value: 1, enumerable: true });
    assert.throws(() => parseGame(save, s.registry));
  }
});
test('checkpoint rewards compare values independently of source property order', () => {
  const original = fixture();
  const s = new GameSession(
    new ContentRegistry({
      ...original.registry.definitions,
      areas: original.registry.definitions.areas.map((a) => ({
        ...a,
        interactables: a.interactables?.map((object) => ({
          ...object,
          rewards: object.rewards.map((r) => ({ amount: r.amount, item: r.item })),
        })),
      })),
    }),
  );
  s.sim.claimObject('crate');
  assert.doesNotThrow(() => parseGame(s.captureSave(), s.registry));
  const invalid = s.captureSave();
  invalid.areas.orchard!.drops![0]!.rewards[0]!.amount++;
  assert.throws(() => parseGame(invalid, s.registry));
});
test('stagger prevents an unalerted enemy from walking home', () => {
  const s = fixture(),
    enemy = s.sim.enemies[0]!;
  enemy.x = -4;
  enemy.stun = 20;
  s.step(idle);
  assert.equal(enemy.x, -4);
});
test('retreat to sanctuary immediately replaces the enemy pursuit route with home', () => {
  const s = fixture(),
    enemy = s.sim.enemies[0]!;
  s.sim.hero.x = -4.5;
  s.step(idle);
  const before = enemy.x;
  s.sim.hero.x = -8;
  s.step(idle);
  assert.ok(enemy.x > before, 'enemy walks toward home rather than the old pursuit target');
});
test('repopulation clears encounter loot, claims, alerts and object animation state', () => {
  const s = fixture();
  s.sim.claimObject('crate');
  s.sim.damage(s.sim.hero, s.sim.enemies[0]!, 1);
  s.sim.potionCooldown = 30;
  s.sim.populate();
  assert.equal(s.sim.drops.length, 0);
  assert.equal(s.sim.claimedObjects.size, 0);
  assert.equal(s.sim.objectActions.size, 0);
  assert.equal(s.sim.potionCooldown, 0);
  assert.equal(s.sim.inCombat, false);
});
test('loot and interaction prompts cannot cross a stair height gap', () => {
  const original = fixture();
  const s = new GameSession(
    new ContentRegistry({
      ...original.registry.definitions,
      areas: original.registry.definitions.areas.map((a) => ({
        ...a,
        surface: {
          kind: 'stairs',
          axis: 'z',
          start: 0,
          end: 4,
          startHeight: 0,
          endHeight: 2,
          steps: 1,
        },
        interactables: a.interactables?.map((object) =>
          object.id === 'crate' ? { ...object, x: -8, z: 0.4 } : object,
        ),
      })),
    }),
  );
  s.sim.hero.z = -0.4;
  assert.equal(nearbyInteraction(s.sim)?.kind, 'campfire');
  s.sim.claimObject('crate');
  assert.equal(s.sim.collectDrop('object-crate'), false);
  assert.equal(nearbyInteraction(s.sim)?.kind, 'campfire');
  s.sim.hero.z = 0.4;
  s.sim.hero.y = 2;
  assert.equal(s.sim.collectDrop('object-crate'), true);
});

function changedAreas(change: (area: AreaDefinition) => AreaDefinition) {
  const original = fixture();
  return new GameSession(
    new ContentRegistry({
      ...original.registry.definitions,
      areas: original.registry.definitions.areas.map((a) =>
        change(structuredClone(a) as AreaDefinition),
      ),
    }),
  );
}
const stairSurface = {
  kind: 'stairs' as const,
  axis: 'z' as const,
  start: 0,
  end: 4,
  startHeight: 0,
  endHeight: 2,
  steps: 1,
};
test('group awareness replaces a displaced ally home route immediately', () => {
  const s = changedAreas((a) => ({
    ...a,
    spawns: a.spawns.map((p) => ({
      ...p,
      awareness: { ...p.awareness!, leash: 20, group: 'watch' },
    })),
  }));
  const ally = s.sim.enemies[1]!;
  ally.x = 2;
  s.step(idle);
  const before = ally.x;
  s.sim.hero.x = -4.5;
  s.step(idle);
  assert.ok(ally.x < before, 'alerted ally follows the hero rather than its cached home route');
});
test('local awareness cannot detect a hero across an unattackable height gap', () => {
  const s = changedAreas((a) => ({
    ...a,
    surface: stairSurface,
    campfires: [],
    spawns: [{ ...a.spawns[0]!, x: 0, z: 0.4 }],
    exits: [],
    interactables: [],
  }));
  Object.assign(s.sim.hero, { x: 0, z: -0.4, y: 0 });
  s.step(idle);
  assert.equal(s.sim.inCombat, false);
  Object.assign(s.sim.hero, { z: 0.4, y: 2 });
  s.step(idle);
  assert.equal(s.sim.inCombat, true);
});
test('campfire sanctuary does not protect a different floor', () => {
  const s = changedAreas((a) => ({
    ...a,
    surface: stairSurface,
    campfires: [{ ...a.campfires![0]!, z: 0.4 }],
    spawns: [{ ...a.spawns[0]!, x: -7, z: -0.4 }],
    exits: [],
    interactables: [],
  }));
  Object.assign(s.sim.hero, { x: -8, z: -0.4, y: 0 });
  s.step(idle);
  assert.equal(s.sim.inCombat, true);
});
test('campfire discovery, rest and travel require unobstructed contact on the same floor', () => {
  for (const stairs of [false, true]) {
    const s = changedAreas((a) => ({
      ...a,
      surface: stairs ? stairSurface : a.surface,
      campfires: [{ ...a.campfires![0]!, z: 0.8 }],
      props: stairs
        ? []
        : [
            {
              id: 'divider',
              kind: 'wall',
              x: -8,
              z: 0.4,
              radius: 0.1,
              height: 2,
              shape: 'box',
              size: [2, 0.1],
            },
          ],
    }));
    s.discovered.add('forest/west');
    assert.throws(() => s.discoverFire('orchard/west'));
    assert.throws(() => s.rest('orchard/west'));
    assert.throws(() => s.prepareFireTravel('forest/west'));
    assert.equal(s.loading, false);
    Object.assign(s.sim.hero, { z: 0.8, y: stairs ? 2 : 0 });
    assert.doesNotThrow(() => s.discoverFire('orchard/west'));
    s.cancelTransition(s.prepareFireTravel('forest/west'));
    assert.doesNotThrow(() => s.rest('orchard/west'));
  }
});
test('adventure starter equipment is present even when the starting room has no fire', () => {
  const s = changedAreas((a) => (a.id === 'orchard' ? { ...a, campfires: [] } : a));
  assert.equal(s.inventory.sword, 1);
  assert.equal(s.equipment.lantern, 'lantern');
});
test('movement preview cannot consume or heal from inventory potions', () => {
  const s = fixture();
  supply(s, 'health-potion', 1);
  s.sim.movementPreview = true;
  s.sim.hero.health = 50;
  const result = s.step({ ...idle, potion: true });
  assert.equal(s.sim.hero.health, 50);
  assert.equal(s.inventory['health-potion'], 1);
  assert.equal(
    result.events.some((e) => e.kind === 'potion-used'),
    false,
  );
});
test('empty reward objects become spent without a ghost loot prompt', () => {
  const s = changedAreas((a) => ({
    ...a,
    interactables: a.interactables?.map((p) => ({
      ...p,
      rewards: [],
    })),
  }));
  assert.equal(s.sim.claimObject('crate'), true);
  assert.equal(s.sim.claimedObjects.has('crate'), true);
  assert.equal(s.sim.drops.length, 0);
  assert.equal(nearbyInteraction(s.sim)?.kind, 'campfire');
});
test('campfire sanctuary also cancels strikes from enemies without local awareness', () => {
  const s = changedAreas((a) => ({
    ...a,
    spawns: [
      {
        ...a.spawns[0]!,
        x: -5.8,
        awareness: undefined,
      },
    ],
    exits: [],
    interactables: [],
  }));
  Object.assign(s.sim.hero, { x: -6.1, z: 0 });
  const enemy = s.sim.enemies[0]!;
  enemy.aim = -Math.PI / 2;
  s.sim.start(enemy, 'attack');
  enemy.age = enemy.definition.melee.windup;
  s.step(idle);
  assert.equal(s.sim.hero.health, 100);
  assert.equal(s.sim.inCombat, false);
  s.sim.hero.x = -5;
  for (let tick = 0; tick < 80; tick++) s.step(idle);
  assert.ok(s.sim.hero.health < 100, 'leaving sanctuary restores enemy attacks');
});
test('adventure checkpoints cannot silently omit all inventory and discovery state', () => {
  const s = fixture(),
    save = s.captureSave();
  delete save.adventure;
  assert.throws(() => parseGame(save, s.registry));
});

test('inventory reads cannot bypass equipment ownership or mutate session state', () => {
  const s = fixture();
  assert.throws(() => Object.assign(s.view.inventory, { gold: -1 }), TypeError);
  assert.throws(() => Object.assign(s.sim.equipment, { ring1: 'orchard-ring' }), TypeError);
  assert.equal(s.inventory.gold, undefined);
  assert.equal(s.equipment.ring1, undefined);
  assert.doesNotThrow(() => parseGame(s.captureSave(), s.registry));
});

test('salvage overflow preserves all ingredients and a loadable checkpoint', () => {
  const s = fixture();
  supply(s, 'damaged-axe', 100000000);
  supply(s, 'damaged-helmet', 1);
  const before = s.captureSave();
  assert.throws(() => s.salvage(), /inventory/i);
  assert.deepEqual(s.captureSave(), before);
  assert.doesNotThrow(() => parseGame(s.captureSave(), s.registry));
});

test('loot overflow preserves the ground drop and existing inventory', () => {
  const s = fixture();
  supply(s, 'gold', 100000000);
  s.sim.claimObject('crate');
  const before = s.captureSave();
  assert.throws(() => s.sim.collectDrop('object-crate'), /inventory/i);
  assert.deepEqual(s.captureSave(), before);
  assert.ok(s.sim.drops.some((d) => d.id === 'object-crate'));
  assert.doesNotThrow(() => parseGame(s.captureSave(), s.registry));
});
