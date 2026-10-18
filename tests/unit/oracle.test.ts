import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type ContentDefinitions } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';
import { Simulation } from '../../src/core/simulation';
import { InventoryState } from '../../src/core/inventory';
import { ribLaneAttack, lanePoint } from '../../src/content/rib-lane';
import { tuning, attackDefinition } from '../../src/content/gameplay';
import { burningSwordBonus } from '../../src/content/items';
import { GameSession } from '../../src/core/session';
import { content, gameScenes } from '../../src/content/game-content';
import { ribLaneEffect } from '../../src/content/combat-feedback';
import { StorageCodec } from '../../src/platform/storage-codec';

const idle = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
test('only areas with a caster acquire rib artwork', () => {
  const asset = ribLaneEffect.asset;
  assert.equal(gameScenes.initialAssets.includes(asset), false);
  for (const area of content.definitions.areas)
    assert.equal(gameScenes.area(area.id).assets.includes(asset), area.id === 'ruined-forge');
});
function fixture(edit?: (defs: ContentDefinitions) => void, inventory = new InventoryState()) {
  const defs = structuredClone(contentDefinitions);
  defs.actors[0]!.attack = { ...ribLaneAttack };
  defs.actors[0]!.maxHealth = 70;
  const area = defs.areas[0]!;
  defs.areas = [area];
  area.exits = [];
  area.props = [];
  area.spawns = [{ id: 'oracle', actor: 'skeleton', x: -4, z: 0 }];
  area.entries = [{ id: 'start', x: 0, z: 0 }];
  edit?.(defs);
  area.entries = [
    ...area.entries,
    ...(area.campfires ?? []).map((fire) => ({ id: 'fire-' + fire.id, x: fire.x, z: fire.z })),
  ];
  return new Simulation(new ContentRegistry(defs), 142, 'court', 1, undefined, inventory);
}

test('Oracle locks a read-only lane, warns without damage, and contacts only once', () => {
  const s = fixture();
  s.step(idle);
  const locked = s.view.ribLanes[0]!;
  assert.equal(locked.x, 0);
  assert.equal(Reflect.set(locked, 'x', 8), false);
  s.hero.x = 0.1;
  for (let i = 1; i < ribLaneAttack.windup; i++) s.step(idle);
  assert.equal(s.hero.health, 100);
  assert.equal(s.ribLanes[0]!.x, 0);
  assert.equal(s.enemies[0]!.x, -4);
  const impact = s.step(idle).events.filter((e) => e.kind === 'damage');
  assert.deepEqual(
    impact.map((e) => e.amount),
    [14],
  );
  for (let i = 0; i < 35; i++) s.step(idle);
  assert.equal(s.hero.health, 86);
  assert.equal(s.ribLanes.length, 0);
  assert.equal(s.enemies[0]!.x, -4, 'cooldown holds position inside casting range');
});

test('stepping out or dodging the lane avoids its only contact', () => {
  for (const dodge of [false, true]) {
    const s = fixture();
    s.step(idle);
    if (dodge) {
      s.start(s.hero, 'dodge');
      s.hero.age = tuning.dodge.invulnerableStart;
    } else Object.assign(s.hero, lanePoint(s.ribLanes[0]!, 0, 1));
    s.enemies[0]!.age = ribLaneAttack.windup;
    s.step(idle);
    s.start(s.hero, 'idle');
    s.step(idle);
    assert.equal(s.hero.health, 100);
  }
});

test('Oracle cancels on sword interruption, lantern stagger, death and repopulation', () => {
  for (const cause of ['sword', 'lantern', 'death', 'populate', 'hero-death'] as const) {
    const s = fixture();
    s.step(idle);
    const enemy = s.enemies[0]!;
    assert.equal(s.ribLanes.length, 1);
    if (cause === 'populate') s.populate();
    else if (cause === 'hero-death') s.damage(enemy, s.hero, 1000);
    else {
      Object.assign(s.hero, { x: enemy.x + 1, z: enemy.z, aim: -Math.PI / 2 });
      if (cause === 'lantern') {
        s.start(s.hero, 'ability');
        s.hero.age = tuning.ability.windup;
        s.step(idle);
      } else {
        s.damage(s.hero, enemy, cause === 'death' ? 1000 : 1);
      }
    }
    assert.equal(s.ribLanes.length, 0, cause);
  }
});

test('replacing a casting actor retires its lane and height still gates contact', () => {
  const s = fixture();
  s.step(idle);
  s.hero.y = 1;
  s.enemies[0]!.age = ribLaneAttack.windup;
  s.step(idle);
  assert.equal(s.hero.health, 100);
  s.actors = [s.hero];
  s.step(idle);
  assert.equal(s.ribLanes.length, 0);
});

test('lanes cannot cross walls, unsupported ground, elevation changes or sanctuary', () => {
  const edits: ((defs: ContentDefinitions) => void)[] = [
    (d) => {
      d.areas[0]!.props = [
        { id: 'wall', kind: 'wall', x: -2, z: 0, radius: 0.4, height: 2, blocking: true },
      ];
    },
    (d) => {
      d.areas[0]!.entries = [{ id: 'start', x: 0, z: 7 }];
      d.areas[0]!.spawns = [{ id: 'oracle', actor: 'skeleton', x: -4, z: 4 }];
    },
    (d) => {
      d.areas[0]!.surface = {
        kind: 'ramp',
        axis: 'z',
        start: -3,
        end: 3,
        startHeight: 0,
        endHeight: 3,
      };
    },
    (d) => {
      d.areas[0]!.campfires = [{ id: 'fire', name: 'Fire', x: 0, z: -2, safeRadius: 0.5 }];
    },
  ];
  for (const edit of edits) {
    const s = fixture(edit);
    s.engaged = true;
    s.step(idle);
    assert.equal(s.hero.health, 100);
    assert.equal(s.ribLanes.length, 0);
  }
  const s = fixture((d) => {
    d.areas[0]!.campfires = [{ id: 'fire', name: 'Fire', x: 4, z: 0, safeRadius: 1 }];
  });
  s.step(idle);
  s.hero.x = 4;
  s.step(idle);
  assert.equal(s.ribLanes.length, 0, 'retreat cancels the already admitted spell');
});

for (const upgraded of [false, true]) {
  test(`Cinder Signet scales direct sword hits once with Edge ${upgraded ? 200 : 100}`, () => {
    const inventory = new InventoryState({
      inventory: { 'cinder-signet': 2 },
      equipment: { ring1: 'cinder-signet', ring2: 'cinder-signet' },
      upgrades: upgraded ? { sword: 1, lantern: 1 } : {},
    });
    assert.equal(burningSwordBonus(inventory.equipment), 25);
    const s = fixture(undefined, inventory),
      target = s.enemies[0]!;
    Object.assign(target, { x: 1, z: 0, health: 1000, stun: 1000 });
    const strike = () => {
      s.hero.aim = Math.PI / 2;
      s.startSword(s.hero, 'lunge');
      s.hero.age = attackDefinition(s.hero).windup;
      return s.step(idle).events.find((e) => e.kind === 'damage')!.amount;
    };
    target.burn = { remaining: 180, nextTick: 60 };
    assert.equal(strike(), upgraded ? 65 : 33);
    target.burn = { remaining: 1, nextTick: 60 };
    assert.equal(strike(), upgraded ? 52 : 26);
    inventory.change({ kind: 'unequip', slot: 'ring1' });
    assert.equal(burningSwordBonus(inventory.equipment), 25);
    inventory.change({ kind: 'unequip', slot: 'ring2' });
    target.burn = { remaining: 180, nextTick: 60 };
    assert.equal(strike(), upgraded ? 52 : 26);
    inventory.change({ kind: 'equip', item: 'cinder-signet', slot: 'ring1' });
    s.start(s.hero, 'ability');
    s.hero.age = tuning.ability.windup;
    assert.equal(s.step(idle).events.find((e) => e.kind === 'damage')!.amount, upgraded ? 32 : 16);
    target.burn = { remaining: 2, nextTick: 1 };
    s.start(s.hero, 'idle');
    assert.equal(s.step(idle).events.find((e) => e.kind === 'damage')!.amount, upgraded ? 8 : 4);
  });
}

test('forge ring reward is one-time and spell actions do not enter version-11 saves', () => {
  const session = new GameSession(content, 142, 'ruined-forge');
  const s = session.sim;
  s.enemies.forEach((a) => {
    a.health = 0;
  });
  const chest = s.areaDefinition.interactables![0]!;
  Object.assign(s.hero, { x: chest.x, z: chest.z });
  assert.equal(s.openContainer(chest.id), true);
  const drop = s.drops.find((d) => d.rewards[0]!.item === 'cinder-signet')!;
  assert.equal(s.collectDrop(drop.id), true);
  const codec = new StorageCodec(content);
  const saved = codec.snapshot('game', session.captureSave());
  assert.equal(saved.version, 11);
  session.restoreSave(saved);
  assert.equal(session.inventory['cinder-signet'], 1);
  session.resetCurrentArea();
  assert.equal(session.sim.openContainer(chest.id), false);
  assert.equal(session.inventory['cinder-signet'], 1);
  const older = structuredClone(saved);
  delete older.adventure!.inventory['cinder-signet'];
  older.adventure!.pack = older.adventure!.pack!.filter((entry) => entry.item !== 'cinder-signet');
  session.restoreSave(codec.snapshot('game', older));
  assert.equal(session.inventory['cinder-signet'] ?? 0, 0);
  assert.equal(session.sim.openContainer(chest.id), false, 'older claimed caches do not refill');
  const spell = fixture();
  spell.step(idle);
  const restored = new Simulation(
    spell.registry,
    142,
    'court',
    2,
    undefined,
    new InventoryState(),
    spell.captureAreaState(),
  );
  assert.equal(restored.ribLanes.length, 0);
  assert.equal(restored.enemies[0]!.state, 'idle');
});

test('room loading cancels a cast even if cancelled; retry and rest leave no spell', () => {
  const session = new GameSession(content, 142, 'ruined-forge');
  const sim = session.sim;
  sim.enemies
    .filter((a) => a.definition.id !== 'candlebone-oracle')
    .forEach((a) => {
      a.health = 0;
    });
  Object.assign(sim.hero, { x: 3, z: 4 });
  session.step(idle);
  assert.equal(sim.ribLanes.length, 1);
  const age = sim.ribLanes[0]!.age;
  const plan = session.prepareReset();
  assert.equal(sim.ribLanes.length, 0);
  assert.equal(sim.enemies.find((a) => a.definition.id === 'candlebone-oracle')!.state, 'idle');
  session.step(idle);
  session.cancelRoom(plan);
  assert.equal(sim.ribLanes.length, 0);
  assert.ok(age > 0);
  session.resetCurrentArea();
  assert.equal(session.sim.ribLanes.length, 0);
  const fire = session.sim.areaDefinition.campfires![0]!;
  Object.assign(session.sim.hero, { x: fire.x, z: fire.z });
  session.discoverFire('ruined-forge/arrival');
  session.rest('ruined-forge/arrival');
  assert.equal(session.sim.ribLanes.length, 0);
});
