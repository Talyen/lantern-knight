import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Navigation, moveSupported, clearSegment } from '../../src/core/navigation';
import {
  ContentRegistry,
  heightAt,
  isSupportedPosition,
  type AreaDefinition,
} from '../../src/content/world';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { Simulation } from '../../src/core/simulation';
import { tuning } from '../../src/content/gameplay';
import { contentDefinitions } from '../../src/content/game-content';
const area = (): AreaDefinition => ({
  ...structuredClone(contentDefinitions.areas[0]!),
  id: 'navigation',
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  playableBoundary: undefined,
  activation: undefined,
  entries: [{ id: 'start', x: -3, z: 0 }],
  baselineEntry: 'start',
  spawns: [{ id: 'enemy', actor: 'skeleton', x: 3, z: 0 }],
  exits: [],
  props: [
    { id: 'wall', kind: 'wall', x: 0, z: 0, radius: 0.2, height: 1, shape: 'box', size: [0.08, 4] },
  ],
});
test('swept movement stops a fast dash at a thin wall and slides along its face', () => {
  const a = area(),
    p = moveSupported(a, { x: -3, z: 0 }, { x: 6, z: 1 }, 0.3);
  assert.ok(p.x < -0.33 && p.x > -0.35);
  assert.ok(p.z > 0.99);
  assert.ok(isSupportedPosition(a, p, 0.3));
  assert.equal(clearSegment(a, { x: -3, z: 0 }, { x: 3, z: 0 }, 0.3), false);
  assert.ok(moveSupported(a, { x: -3, z: 0 }, { x: -10, z: 0 }, 0.3).x >= -4.70001);
});
test('routes go around walls, preserve clearance, and distinguish an unreachable destination', () => {
  const a = area(),
    nav = new Navigation(a),
    start = { x: -3, z: 0 },
    goal = { x: 3, z: 0 },
    route = nav.route(start, goal, 0.3);
  assert.equal(route.status, 'ready');
  assert.ok(route.points.some((p) => Math.abs(p.z) > 2.3));
  let p = start;
  for (const next of route.points) {
    assert.ok(clearSegment(a, p, next, 0.3));
    p = next;
  }
  assert.equal(nav.route(start, { x: 0, z: 0 }, 0.3).status, 'unreachable');
  const closed = area();
  closed.props = [{ ...closed.props[0]!, size: [0.08, 10] }];
  assert.equal(new Navigation(closed).route(start, goal, 0.3).status, 'unreachable');
});
test('a diagonal cannot cut a polygon corner and different actor radii change passage access', () => {
  const a = area();
  a.props = [
    {
      id: 'poly',
      kind: 'wall',
      x: 0,
      z: 0,
      radius: 0.2,
      height: 1,
      shape: 'polygon',
      polygon: [
        { x: -1, z: -1 },
        { x: 1, z: -1 },
        { x: 1, z: 1 },
        { x: -1, z: 1 },
      ],
    },
  ];
  const p = moveSupported(a, { x: -2, z: -2 }, { x: 4, z: 4 }, 0.3);
  assert.ok(p.x < -1 && p.z < -1);
  a.props = [
    {
      id: 'upper',
      kind: 'wall',
      x: 0,
      z: 2.2,
      radius: 0.2,
      height: 1,
      shape: 'box',
      size: [10, 3.5],
    },
    {
      id: 'lower',
      kind: 'wall',
      x: 0,
      z: -2.2,
      radius: 0.2,
      height: 1,
      shape: 'box',
      size: [10, 3.5],
    },
  ];
  assert.equal(new Navigation(a).route({ x: -3, z: 0 }, { x: 3, z: 0 }, 0.3).status, 'ready');
  assert.equal(new Navigation(a).route({ x: -3, z: 0 }, { x: 3, z: 0 }, 0.5).status, 'unreachable');
});
test('movement preview routes enemies around scenery without damage; populate clears destinations', () => {
  const a = area(),
    registry = new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
    sim = new Simulation(registry);
  sim.movementPreview = true;
  const hp = sim.hero.health;
  for (let i = 0; i < 900; i++)
    sim.step({ move: { x: 0, z: 0 }, aim: { x: 1, z: 0 }, attack: true, ability: true });
  assert.equal(sim.hero.health, hp);
  assert.ok(sim.enemies[0]!.x < 0);
  assert.ok(sim.actors.every((p) => isSupportedPosition(a, p, 0.3)));
  sim.setMovementTarget(sim.hero.id, { x: -3, z: 3 });
  assert.ok(sim.navigationDebug().routes.length);
  sim.populate();
  assert.equal(sim.navigationDebug().routes.length, 0);
});

const still = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
function simulate(a: AreaDefinition) {
  return new Simulation(
    new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
  );
}

test('lantern flare cannot damage or stagger an enemy through blocking scenery', () => {
  const a = area();
  a.entries = [{ id: 'start', x: -0.6, z: 0 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: 0.6, z: 0 }];
  const sim = simulate(a),
    enemy = sim.enemies[0]!;
  sim.hero.aim = Math.PI / 2;
  sim.start(sim.hero, 'ability');
  sim.hero.age = tuning.ability.windup;
  const blocked = sim.step(still);
  assert.equal(enemy.health, enemy.definition.maxHealth);
  assert.equal(enemy.stun, 0);
  assert.ok(!blocked.events.some((e) => e.kind === 'damage' || e.kind === 'stagger'));

  a.props = [];
  const open = simulate(a);
  open.hero.aim = Math.PI / 2;
  open.start(open.hero, 'ability');
  open.hero.age = tuning.ability.windup;
  open.step(still);
  assert.equal(open.enemies[0]!.health, enemy.definition.maxHealth - tuning.ability.damage);
  assert.ok(open.enemies[0]!.stun > 0);
});

test('health pickups remain available when scenery blocks contact', () => {
  const a = area();
  a.entries = [{ id: 'start', x: -0.4, z: 0 }];
  a.spawns = [];
  a.pickups = [
    { id: 'health', object: 'health-art', kind: 'health', x: 0.4, z: 0, radius: 1, amount: 20 },
  ];
  const sim = simulate(a);
  sim.hero.health = 50;
  sim.step(still);
  assert.equal(sim.hero.health, 50);
  assert.equal(sim.collectedPickups.size, 0);
  // Walking around the wall to the pickup side permits collection.
  sim.hero.x = 0.4;
  sim.step(still);
  assert.equal(sim.hero.health, 70);
  assert.ok(sim.collectedPickups.has('health'));
});

test('coincident living spawns separate deterministically without leaving supported ground', () => {
  const a = area();
  a.props = [];
  a.spawns = [
    { id: 'first', actor: 'skeleton', x: 1, z: 0 },
    { id: 'second', actor: 'skeleton', x: 1, z: 0 },
  ];
  const sim = simulate(a);
  for (const enemy of sim.enemies) enemy.stun = 100;
  sim.step(still);
  const [first, second] = sim.enemies;
  assert.ok(
    Math.hypot(first!.x - second!.x, first!.z - second!.z) >=
      first!.definition.radius + second!.definition.radius - 1e-6,
  );
  assert.ok(sim.enemies.every((e) => isSupportedPosition(a, e, 0.3)));
  const replay = simulate(a);
  for (const enemy of replay.enemies) enemy.stun = 100;
  replay.step(still);
  assert.deepEqual(
    replay.enemies.map((e) => [e.x, e.z]),
    sim.enemies.map((e) => [e.x, e.z]),
  );
});

test('a route reaches destinations closer than one walking step instead of discarding them', () => {
  const a = area();
  a.spawns = [];
  const sim = simulate(a),
    goal = { x: sim.hero.x + 0.02, z: sim.hero.z };
  sim.setMovementTarget(sim.hero.id, goal);
  sim.step(still);
  assert.ok(Math.hypot(sim.hero.x - goal.x, sim.hero.z - goal.z) < 1e-6);
  sim.step(still);
  assert.equal(sim.hero.state, 'idle');
});

test('an enemy pursues across a stair height gap instead of repeatedly swinging out of reach', () => {
  const a = area();
  a.props = [];
  a.surface = {
    kind: 'stairs',
    axis: 'z',
    start: 0,
    end: 4,
    startHeight: 0,
    endHeight: 2,
    steps: 1,
  };
  a.entries = [{ id: 'start', x: 0, z: 0.4 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: 0, z: -0.4 }];
  const sim = simulate(a),
    enemy = sim.enemies[0]!,
    originalZ = enemy.z;
  assert.ok(
    Math.abs(heightAt(a, enemy.x, enemy.z) - sim.hero.y) > tuning.maxCombatHeightDifference,
  );
  sim.step(still);
  assert.equal(enemy.state, 'walk');
  assert.ok(enemy.z > originalZ);
  for (let i = 0; i < 180; i++) sim.step(still);
  assert.ok(sim.hero.health < sim.hero.definition.maxHealth);
});

test('health pickups cannot be collected across a stair height gap', () => {
  const a = area();
  a.props = [];
  a.spawns = [];
  a.surface = {
    kind: 'stairs',
    axis: 'z',
    start: 0,
    end: 4,
    startHeight: 0,
    endHeight: 2,
    steps: 1,
  };
  a.entries = [{ id: 'start', x: 0, z: -0.4 }];
  a.pickups = [
    { id: 'health', object: 'health-art', kind: 'health', x: 0, z: 0.4, radius: 1, amount: 20 },
  ];
  const sim = simulate(a);
  sim.hero.health = 50;
  sim.step(still);
  assert.equal(sim.hero.health, 50);
  assert.equal(sim.collectedPickups.size, 0);
  sim.move(sim.hero, 0, 0.8);
  sim.step(still);
  assert.equal(sim.hero.health, 70);
  assert.ok(sim.collectedPickups.has('health'));
});

test('actors on opposite sides of a stair height gap do not push each other', () => {
  const a = area();
  a.props = [];
  a.surface = {
    kind: 'stairs',
    axis: 'z',
    start: 0,
    end: 4,
    startHeight: 0,
    endHeight: 2,
    steps: 1,
  };
  a.entries = [{ id: 'start', x: 0, z: 0.1 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: 0, z: -0.1 }];
  const sim = simulate(a);
  sim.enemies[0]!.stun = 100;
  sim.step(still);
  assert.equal(sim.hero.z, 0.1);
  assert.equal(sim.enemies[0]!.z, -0.1);
});

test('a valid checkpoint near a wall can resume diagonal movement with runtime clearance', () => {
  const a = area();
  const registry = new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] });
  const session = new GameSession(registry);
  Object.assign(session.sim.hero, { x: -0.34, z: 0 });
  const save = session.captureSave();
  assert.doesNotThrow(() => parseGame(save, registry));
  session.restoreSave(save);
  session.step({ move: { x: -Math.SQRT1_2, z: Math.SQRT1_2 }, aim: { x: -1, z: 1 } });
  assert.ok(session.sim.hero.x < save.player.x);
  assert.ok(session.sim.hero.z > save.player.z);
  assert.ok(isSupportedPosition(a, session.sim.hero, 0.3));
});

test('checkpoint validation rejects boundary-trapped actors even when projection cannot move them', () => {
  const a = area();
  a.props = [{ id: 'trap', kind: 'pillar', x: 4.4, z: 0, radius: 0.6, height: 1 }];
  const registry = new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] });
  const session = new GameSession(registry);
  const trapped = { x: 4.7, z: 0 };
  assert.equal(isSupportedPosition(a, trapped, 0.3), false);
  assert.equal(new Navigation(a).route(trapped, { x: 0, z: 0 }, 0.3).status, 'unreachable');
  const playerSave = session.captureSave();
  Object.assign(playerSave.player, trapped);
  assert.throws(() => parseGame(playerSave, registry), /Unsupported saved player position/);
  const enemySave = session.captureSave();
  Object.assign(enemySave.areas[a.id]!.actors.enemy!, trapped);
  assert.throws(() => parseGame(enemySave, registry), /Unsupported saved actor position/);
});

test('checkpoint clearance uses the same minimum actor radius as movement', () => {
  const a = area();
  const registry = new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] });
  const save = new GameSession(registry).captureSave();
  Object.assign(save.player, { x: -0.3, z: 0 });
  assert.throws(() => parseGame(save, registry), /Unsupported saved player position/);
});

test('an explicitly routed actor replans after displacement puts a wall across its next segment', () => {
  const a = area();
  a.spawns = [];
  const sim = simulate(a),
    goal = { x: -3, z: 1 };
  Object.assign(sim.hero, { x: -0.4, z: 2.5 });
  sim.setMovementTarget(sim.hero.id, goal);
  // Move around the wall's tip after planning a route down its left side.
  sim.move(sim.hero, 0.8, 0);
  sim.move(sim.hero, 0, -0.4);
  for (let i = 0; i < 300; i++) sim.step(still);
  assert.ok(Math.hypot(sim.hero.x - goal.x, sim.hero.z - goal.z) < 1e-6);
  assert.ok(isSupportedPosition(a, sim.hero, 0.3));
});
