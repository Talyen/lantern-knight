import { boxProp } from '../fixtures/world';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Navigation, moveSupported } from '../../src/core/navigation';
import { clearSegment } from '../../src/content/collision';
import { ContentRegistry, heightAt, type AreaDefinition } from '../../src/content/world';
import { isSupportedPosition } from '../../src/content/collision';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { Simulation } from '../../src/core/simulation';
import { PickupPlan } from '../../src/core/pickup-plan';
import { MovementPlans } from '../../src/core/movement-plans';
import { EncounterBehavior } from '../../src/core/encounter-behavior';
import { tuning } from '../../src/content/gameplay';
import { sweepCircle } from '../../src/content/collision';
import { content, contentDefinitions } from '../fixtures/content';
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
  props: [boxProp({ id: 'wall', radius: 0.2, size: [0.08, 4] })],
});
test('cached grid geometry retains live, directed room traversal policy', () => {
  const a = area();
  const registry = new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] });
  let guarded = false;
  const navigation = new Navigation(registry.area(a.id), {
    position: () => true,
    segment: (start, end) => !(guarded && start.x < -1 && end.x >= -1),
  });
  const left = { x: -3, z: 0 },
    right = { x: 3, z: 0 };
  assert.equal(navigation.route(left, right, 0.3).status, 'ready');
  guarded = true;
  assert.equal(navigation.route(left, right, 0.3).status, 'unreachable');
  assert.equal(navigation.route(right, left, 0.3).status, 'ready');
});

test('mutable navigation drafts still check support after blockers change', () => {
  for (const initiallyFrozen of [false, true]) {
    const a = area(),
      blockers = [...a.props],
      start = { x: -3, z: 0 },
      goal = { x: 3, z: 0 };
    a.props = blockers;
    if (initiallyFrozen) Object.freeze(a);
    const navigation = new Navigation(a);
    assert.equal(navigation.route(start, goal, 0.3).status, 'ready');
    Object.freeze(a); // A shallow root freeze does not make its nested geometry immutable.
    blockers.push(boxProp({ id: 'closed-door', x: -1, size: [0.08, 10] }));
    assert.equal(navigation.route(start, goal, 0.3).status, 'unreachable');
  }
});

test('swept edge pruning retains rounded corners and tolerated initial contact', () => {
  const a = area();
  const corner = sweepCircle(a, { x: -1, z: -2.2 }, { x: 2, z: 0 }, 0.3);
  assert.ok(corner);
  assert.ok(Math.abs(corner.t - (1 - 0.04 - Math.sqrt(0.3 ** 2 - 0.2 ** 2)) / 2) < 1e-12);
  assert.ok(Math.abs(corner.nx + Math.sqrt(0.3 ** 2 - 0.2 ** 2) / 0.3) < 1e-12);
  assert.ok(Math.abs(corner.nz + 2 / 3) < 1e-12);
  const touching = sweepCircle(a, { x: -0.34 + 5e-7, z: 0 }, { x: 1, z: 0 }, 0.3);
  assert.ok(touching);
  assert.equal(touching.t, 0);
  assert.equal(touching.nx, -1);
  assert.equal(Math.abs(touching.nz), 0);
});

test('loot routing can use the full interaction reach beyond a deep narrow recess', () => {
  const a = area();
  a.spawns = [];
  a.props = [-0.25, 0.25].map((z, i) => boxProp({ id: 'recess-' + i, z, size: [2.7, 0.1] }));
  const sim = new Simulation(
    new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
  );
  sim.drops.push({
    id: 'loot',
    source: 'crate',
    enemy: false,
    x: 0,
    z: 0,
    rewards: [{ item: 'gold', amount: 1 }],
  });
  const plan = new PickupPlan();
  assert.equal(plan.request(sim, 'loot'), true);
  let ready: string | undefined;
  for (let tick = 0; tick < 100 && !ready; tick++) {
    sim.step();
    ready = plan.ready(sim);
  }
  assert.equal(ready, 'loot');
  assert.equal(sim.collectDrop(ready!), true);
  assert.equal(sim.inventory.gold, 1);
});

test('rejected loot clicks preserve an accepted pickup and its route', () => {
  const a = area();
  a.spawns = [];
  a.props = [{ ...a.props[0]!, size: [0.08, 10] }];
  const sim = new Simulation(
    new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
  );
  sim.drops.push(
    ...[-1, 3].map((x, i) => ({
      id: 'loot-' + i,
      source: 'crate',
      enemy: false,
      x,
      z: 0,
      rewards: [{ item: 'gold', amount: 1 }],
    })),
  );
  const plan = new PickupPlan();
  assert.equal(plan.request(sim, 'loot-0'), true);
  const route = sim.navigationDebug(false).routes;
  assert.equal(plan.request(sim, 'missing'), false);
  assert.equal(plan.request(sim, 'loot-1'), false);
  assert.deepEqual(sim.navigationDebug(false).routes, route);
  let ready: string | undefined;
  for (let tick = 0; tick < 100 && !ready; tick++) {
    sim.step();
    ready = plan.ready(sim);
  }
  assert.equal(ready, 'loot-0');
  assert.equal(sim.collectDrop(ready!), true);
});

test('an unreachable route waits for displacement, then immediately retries its destination', (t) => {
  const a = area();
  a.props = [{ ...a.props[0]!, size: [0.08, 10] }];
  a.spawns = [];
  const routes = t.mock.method(Navigation.prototype, 'route');
  const sim = new Simulation(
    new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
  );
  sim.setMovementTarget(sim.hero.id, { x: 3, z: 0 });
  assert.equal(sim.navigationDebug(false).routes[0]!.status, 'unreachable');
  for (let i = 0; i < 60; i++) sim.step({ move: { x: 0, z: 0 }, aim: { x: -3, z: 2 } });
  assert.equal(sim.hero.yaw, 0, 'a blocked route must still allow idle aiming');
  assert.equal(routes.mock.callCount(), 1, 'unchanged impossible paths are not searched again');
  for (let i = 0; i < 15; i++) {
    sim.hero.z += 0.001; // Separation can displace a blocked actor every tick.
    sim.step();
  }
  assert.equal(routes.mock.callCount(), 2, 'continuous displacement retains the retry cadence');
  Object.assign(sim.hero, { x: 2, z: 0 });
  sim.step();
  assert.ok(sim.hero.x > 2, 'displacement retries without waiting for a timer');
  for (let i = 0; i < 60; i++) sim.step();
  assert.ok(sim.hero.x >= 2.99);
});

test('navigation connects endpoints beyond a disconnected nearest grid node', () => {
  const a = area();
  a.bounds = { minX: -3, maxX: 3, minZ: -3, maxZ: 3 };
  a.props = [
    boxProp({ id: 'right', x: 1.88, z: -1.61, size: [2.06, 1.88] }),
    boxProp({ id: 'left', x: -1.93, z: 1.11, size: [1.74, 0.12] }),
    boxProp({ id: 'middle', x: -0.27, z: 0.24, size: [1.26, 0.76] }),
  ];
  const start = { x: 1.89, z: 1.37 },
    goal = { x: -0.02, z: -1.13 },
    via = { x: 2.61, z: 1.67 };
  a.entries = [{ id: 'start', ...start }];
  a.spawns = [];
  const registry = new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] });
  const navigation = new Navigation(registry.area(a.id));
  assert.ok(navigation.clear(start, via, 0.3));
  assert.ok(navigation.clear(via, goal, 0.3));
  const route = navigation.route(start, goal, 0.3);
  assert.equal(route.status, 'ready');
  let previous = start;
  for (const point of route.points) {
    assert.ok(navigation.clear(previous, point, 0.3));
    previous = point;
  }
  assert.deepEqual(previous, goal);
});
test('swept movement stops a fast dash at a thin wall and slides along its face', () => {
  const a = area(),
    p = moveSupported(a, { x: -3, z: 0 }, { x: 6, z: 1 }, 0.3);
  assert.ok(p.x < -0.33 && p.x > -0.35);
  assert.ok(p.z > 0.99);
  assert.ok(isSupportedPosition(a, p, 0.3));
  assert.equal(clearSegment(a, { x: -3, z: 0 }, { x: 3, z: 0 }, 0.3), false);
  assert.ok(moveSupported(a, { x: -3, z: 0 }, { x: -10, z: 0 }, 0.3).x >= -4.70001);
  const corrected = moveSupported(a, { x: 0, z: 0 }, { x: 0, z: 0 }, 0.3);
  assert.ok(
    isSupportedPosition(a, corrected, 0.3),
    'idle placement still repairs unsupported footing',
  );
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
    boxProp({ id: 'upper', z: 2.2, radius: 0.2, size: [10, 3.5] }),
    boxProp({ id: 'lower', z: -2.2, radius: 0.2, size: [10, 3.5] }),
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
    sim.step({ move: { x: 0, z: 0 }, aim: { x: 1, z: 0 }, actions: ['sword', 'lantern'] });
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

test('enemy pursuit and home routes avoid campfire sanctuary while hero routes remain open', () => {
  const a = area();
  a.props = [];
  a.entries = [...a.entries, { id: 'fire-center', x: 0, z: 0 }];
  a.campfires = [{ id: 'center', name: 'Campfire', x: 0, z: 0, safeRadius: 1.5 }];
  const sim = simulate(a),
    enemy = sim.enemies[0]!;
  let furthest = 0;
  for (let i = 0; i < 600 && sim.hero.health === sim.maxHealth; i++) {
    sim.step(still);
    furthest = Math.max(furthest, Math.abs(enemy.z));
    assert.ok(Math.hypot(enemy.x, enemy.z) >= 1.5, 'Pursuit cannot enter sanctuary');
  }
  assert.ok(sim.hero.health < sim.maxHealth, 'An open route around the sanctuary reaches combat');
  assert.ok(furthest >= 1.5);

  Object.assign(sim.hero, { x: 0, z: 0 });
  for (let i = 0; i < 600; i++) {
    sim.step(still);
    assert.ok(Math.hypot(enemy.x, enemy.z) >= 1.5, 'Returning home cannot enter sanctuary');
  }
  assert.ok(Math.hypot(enemy.x - 3, enemy.z) < 1e-6, 'Home return uses the same detour');
  sim.setMovementTarget(sim.hero.id, { x: -3, z: 0 });
  for (let i = 0; i < 100; i++) sim.step(still);
  assert.ok(Math.hypot(sim.hero.x + 3, sim.hero.z) < 1e-6, 'Hero navigation crosses sanctuary');
});

test('enemy traversal preserves sanctuary topology and permits an outward escape from old placements', () => {
  const a = area();
  a.props = [];
  a.entries = [...a.entries, { id: 'fire-center', x: 0, z: 0 }];
  a.campfires = [{ id: 'center', name: 'Campfire', x: 0, z: 0, safeRadius: 1.5 }];
  const sim = simulate(a),
    enemy = sim.enemies[0]!;
  sim.move(enemy, -6, 0);
  assert.equal(enemy.x, 3, 'A long movement cannot tunnel through sanctuary');
  Object.assign(enemy, { x: 0.2, z: 0 });
  sim.move(enemy, -0.1, 0);
  assert.equal(enemy.x, 0.2, 'An existing inside placement cannot move deeper');
  sim.movementPreview = true;
  sim.setMovementTarget(enemy.id, { x: 3, z: 0 });
  for (let i = 0; i < 200 && Math.abs(enemy.x - 3) > 1e-6; i++) sim.step(still);
  assert.ok(Math.abs(enemy.x - 3) < 1e-6, 'The existing placement can escape outward');

  a.surface = {
    kind: 'stairs',
    axis: 'z',
    start: 0,
    end: 4,
    startHeight: 0,
    endHeight: 2,
    steps: 1,
  };
  a.entries = [a.entries[0]!, { id: 'fire-center', x: 0, z: 0.4 }];
  a.campfires = [{ ...a.campfires[0]!, z: 0.4 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: 1, z: -0.4 }];
  const lower = simulate(a);
  lower.move(lower.enemies[0]!, -2, 0);
  assert.equal(lower.enemies[0]!.x, -1, 'Sanctuary does not block a different elevation');
  a.campfires = [{ ...a.campfires[0]!, safeRadius: 1e-12 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: 1, z: 0.4 }];
  const tiny = simulate(a);
  tiny.move(tiny.enemies[0]!, -2, 0);
  assert.equal(tiny.enemies[0]!.x, 1, 'Even a tiny sanctuary blocks a crossing');
  a.surface = {
    ...a.surface,
    terraceBounds: { minX: -2, maxX: 2, minZ: 0, maxZ: 3 },
    stairWidth: 1,
  };
  a.entries = [a.entries[0]!, { id: 'fire-center', x: 0, z: 5e-13 }];
  a.campfires = [{ ...a.campfires[0]!, x: 0, z: 5e-13 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: 1, z: -5e-13 }];
  const tinyAbove = simulate(a);
  tinyAbove.move(tinyAbove.enemies[0]!, -2, 0);
  assert.equal(tinyAbove.enemies[0]!.x, -1, 'A tiny fire on another floor stays traversable');

  a.surface = { kind: 'flat', height: 0 };
  a.props = [boxProp({ id: 'wall', radius: 0.2, size: [0.08, 4] })];
  a.entries = [a.entries[0]!, { id: 'fire-center', x: 0.5, z: 0 }];
  a.campfires = [{ ...a.campfires[0]!, x: 0.5, z: 0, safeRadius: 1.5 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: -0.6, z: -1 }];
  const occluded = simulate(a);
  occluded.move(occluded.enemies[0]!, 0, 2);
  assert.equal(occluded.enemies[0]!.z, 1, 'Sanctuary does not extend through blocking scenery');
});

test('sanctuary traversal detects narrow terrace and visibility fragments regardless of segment length', () => {
  const a = area();
  a.props = [];
  a.bounds = { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };
  a.surface = {
    kind: 'stairs',
    axis: 'z',
    start: 1.5,
    end: 5.5,
    startHeight: 0,
    endHeight: 2,
    steps: 1,
    stairWidth: 0.5,
    terraceBounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
  };
  a.campfires = [{ id: 'center', name: 'Campfire', x: 0.9, z: 0.01, safeRadius: 1.5 }];
  a.entries = [...a.entries, { id: 'fire-center', x: 0.9, z: 0.01 }];
  const terrace = new EncounterBehavior(simulate(a).areaDefinition);
  assert.equal(terrace.safePoint({ x: 0.005, z: 0.005 }), true);
  assert.equal(terrace.traversal.segment({ x: -0.001, z: 0.011 }, { x: 0.001, z: 0.009 }), false);
  assert.equal(terrace.traversal.segment({ x: -2, z: 2.01 }, { x: 2, z: -1.99 }), false);

  a.surface = { kind: 'flat', height: 0 };
  a.campfires = [{ ...a.campfires[0]!, x: 0, z: 0, safeRadius: 3 }];
  a.entries = [a.entries[0]!, { id: 'fire-center', x: 0, z: 0 }];
  a.props = [
    boxProp({ id: 'left', x: -2.4995, z: 0.5, size: [5.001, 0.02] }),
    boxProp({ id: 'right', x: 2.5045, z: 0.5, size: [4.991, 0.02] }),
  ];
  const slit = new EncounterBehavior(simulate(a).areaDefinition);
  assert.equal(slit.safePoint({ x: 0.01, z: 1 }), true);
  assert.equal(slit.traversal.segment({ x: -2, z: 1 }, { x: 2, z: 1 }), false);
});

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
test('lantern recoil stops at a blocking wall and the walkable floor boundary', () => {
  for (const obstruction of ['wall', 'edge'] as const) {
    const a = area();
    a.entries = [{ id: 'start', x: -2, z: 0 }];
    a.spawns = [{ id: 'enemy', actor: 'skeleton', x: -0.8, z: 0 }];
    if (obstruction === 'edge') {
      a.props = [];
      a.bounds.maxX = 0;
    }
    const sim = simulate(a),
      enemy = sim.enemies[0]!;
    sim.start(sim.hero, 'ability');
    sim.hero.age = tuning.ability.windup;
    for (let tick = 0; tick < tuning.ability.recoilTicks; tick++) {
      sim.step(still);
      assert.ok(isSupportedPosition(a, enemy, 0.3));
    }
    assert.ok(enemy.x > -0.8 && enemy.x <= -0.3);
    assert.equal(enemy.health, enemy.definition.maxHealth - tuning.ability.damage);
  }
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

function stairArea(): AreaDefinition {
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
  return a;
}

test('an enemy pursues across a stair height gap instead of repeatedly swinging out of reach', () => {
  const a = stairArea();
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
  const a = stairArea();
  a.spawns = [];
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
  const a = stairArea();
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

test('registry rejects obstructed entries and spawns before a session can create invalid checkpoints', () => {
  const makeRegistry = (a: AreaDefinition) =>
    new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] });
  const blockedEntry = area();
  // Alternate entries are used by transitions even when the baseline is valid.
  blockedEntry.entries = [...blockedEntry.entries, { id: 'arrival', x: 0, z: 0 }];
  assert.throws(() => makeRegistry(blockedEntry), /unsupported entry navigation\/arrival/);

  const blockedSpawn = area();
  blockedSpawn.spawns = [{ ...blockedSpawn.spawns[0]!, x: 0, z: 0 }];
  assert.throws(() => makeRegistry(blockedSpawn), /unsupported spawn navigation\/enemy/);

  const edgeEntry = area();
  edgeEntry.entries = [{ id: 'start', x: -4.8, z: 0 }];
  assert.throws(() => makeRegistry(edgeEntry), /unsupported entry navigation\/start/);

  const jitter = area();
  jitter.spawns = [{ id: 'enemy', actor: 'skeleton', x: 0, z: -3, jitterZ: 6 }];
  // Both endpoints are clear, but some seeds put the enemy inside the wall.
  assert.throws(() => makeRegistry(jitter), /unsupported spawn navigation\/enemy/);

  const valid = area();
  valid.spawns = [{ ...valid.spawns[0]!, jitterZ: 1 }];
  const registry = makeRegistry(valid);
  for (const seed of [0, 142, 4294967295]) {
    const session = new GameSession(registry, seed);
    assert.doesNotThrow(() => parseGame(session.captureSave(), registry));
  }
});

test('movement preview does not consume health rewards or mutate player health', () => {
  const a = area();
  a.props = [];
  a.spawns = [];
  a.pickups = [
    { id: 'health', object: 'health-art', kind: 'health', x: -3, z: 0, radius: 1, amount: 20 },
  ];
  const sim = simulate(a);
  sim.hero.health = 50;
  sim.movementPreview = true;
  const result = sim.step(still);
  assert.equal(sim.hero.health, 50);
  assert.equal(sim.collectedPickups.size, 0);
  assert.ok(!result.events.some((e) => e.kind === 'pickup'));
  sim.movementPreview = false;
  sim.step(still);
  assert.equal(sim.hero.health, 70);
});

test('content rejects a self-intersecting star masquerading as a convex playable boundary', () => {
  const a = area();
  const ring = Array.from({ length: 5 }, (_, i) => ({
    x: 4 * Math.cos((i * Math.PI * 2) / 5),
    z: 4 * Math.sin((i * Math.PI * 2) / 5),
  }));
  a.playableBoundary = [0, 2, 4, 1, 3].map((i) => ring[i]!);
  assert.throws(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
    /convex/,
  );
});

test('idle aim and movement deadzone preserve position; completing a route releases manual control', () => {
  const a = area();
  a.props = [];
  a.spawns = [];
  const sim = simulate(a);
  sim.hero.aim = 1.2;
  sim.step();
  assert.equal(sim.hero.aim, 1.2);
  const before = { x: sim.hero.x, z: sim.hero.z };
  sim.step({ ...still, move: { x: 0.005, z: 0 } });
  assert.deepEqual({ x: sim.hero.x, z: sim.hero.z }, before);
  const goal = { x: sim.hero.x + 0.02, z: sim.hero.z };
  sim.setMovementTarget(sim.hero.id, goal);
  sim.step(still);
  assert.ok(Math.hypot(sim.hero.x - goal.x, sim.hero.z - goal.z) < 1e-6);
  sim.step(still);
  sim.step({ ...still, aim: { x: sim.hero.x, z: sim.hero.z + 2 } });
  assert.equal(sim.navigationDebug().routes.length, 0);
  assert.equal(sim.hero.yaw, 0);
});

test('route ownership switches automatic intent immediately and preserves manual priority', () => {
  const a = area();
  a.props = [];
  const sim = simulate(a),
    enemy = sim.enemies[0]!,
    plans = new MovementPlans(sim.areaDefinition),
    move = (actor: typeof enemy, x: number, z: number) => sim.move(actor, x, z),
    pursuit = { kind: 'pursuit' as const, target: { x: -2, z: 0 } },
    home = { kind: 'home' as const, target: { x: 4, z: 0 } };
  plans.follow(enemy, 1, move, pursuit);
  const pursuing = enemy.x;
  plans.follow(enemy, 2, move, home);
  assert.ok(enemy.x > pursuing, 'home intent replaces pursuit before its replan deadline');
  const returning = enemy.x;
  plans.follow(enemy, 3, move, pursuit);
  assert.ok(enemy.x < returning, 'pursuit replaces home without an awareness cache callback');

  plans.setManual(enemy, { x: 4, z: 0 }, 4);
  const commanded = enemy.x;
  plans.follow(enemy, 5, move, pursuit);
  assert.ok(enemy.x > commanded, 'automatic pursuit cannot override a manual command');
  plans.clear();
  assert.deepEqual(plans.debug(enemy.definition.radius, false).routes, []);
});

test('automatic boundary departures still work when their marker is beyond the walking bounds', () => {
  const registry = new ContentRegistry(structuredClone(contentDefinitions));
  const sim = new Simulation(registry, 142, 'upper-landing');
  Object.assign(sim.hero, { x: 0, z: 8.3, y: 0 });
  assert.equal(sim.step().transition, 'court');
});

test('movement preview stays in its room when walking onto an automatic exit', () => {
  const sim = new Simulation(content);
  sim.movementPreview = true;
  sim.enemies.forEach((enemy) => {
    enemy.health = 0;
  });
  sim.cleared = true;
  Object.assign(sim.hero, { x: 0, z: -5.9 });
  assert.equal(sim.step().transition, undefined);
  sim.movementPreview = false;
  assert.equal(sim.step().transition, 'landing');
});

test('pickup routes survive rejected input and cancel on admitted player movement', () => {
  const sim = new Simulation(content);
  sim.drops.push({
    id: 'loot',
    source: 'test',
    enemy: false,
    x: 3,
    z: 5,
    rewards: [{ item: 'gold', amount: 1 }],
  });
  const plan = new PickupPlan();
  assert.equal(plan.request(sim, 'loot'), true);
  plan.beforeStep(sim, {
    move: { x: 1, z: 0 },
    aim: { x: 0, z: 0 },
    actions: ['sword'],
    generation: sim.generation - 1,
  });
  assert.equal(sim.navigationDebug(false).routes.length, 1);
  plan.beforeStep(sim, {
    move: { x: Infinity, z: 0 },
    aim: { x: 0, z: 0 },
    actions: [],
  });
  assert.equal(sim.navigationDebug(false).routes.length, 1);
  plan.beforeStep(sim, { move: { x: 1, z: 0 }, aim: { x: 0, z: 0 } });
  assert.equal(sim.navigationDebug(false).routes.length, 0);
});

test('large enemies choose melee positions within the hero height range', () => {
  const a = area();
  a.surface = { kind: 'ramp', axis: 'x', start: -5, end: 5, startHeight: 0, endHeight: 5 };
  a.entries = [{ id: 'start', x: 0, z: 0 }];
  a.spawns = [{ id: 'enemy', actor: 'skeleton', x: -4, z: 0 }];
  a.props = [-0.55, 0.55].map((z, i) => ({
    id: 'post-' + i,
    kind: 'pillar' as const,
    x: 0,
    z,
    radius: 0.15,
    height: 1,
  }));
  const definitions = structuredClone(contentDefinitions);
  definitions.actors[0]!.radius = 0.7;
  definitions.actors[0]!.attack.range = 2;
  const sim = new Simulation(
    new ContentRegistry({ ...definitions, initialArea: a.id, areas: [a] }),
  );
  for (let i = 0; i < 700 && sim.hero.health === sim.maxHealth; i++) sim.step();
  assert.ok(
    sim.hero.health < sim.maxHealth,
    'a reachable position beside the recess permits melee',
  );
});

test('pursuit reuses a route to a stationary target and replans when that target moves', (t) => {
  const a = area();
  a.props = [];
  const sim = simulate(a),
    enemy = sim.enemies[0]!,
    plans = new MovementPlans(sim.areaDefinition),
    routes = t.mock.method(Navigation.prototype, 'route'),
    move = (actor: typeof enemy, x: number, z: number) => sim.move(actor, x, z);
  for (let tick = 0; tick < 60; tick++)
    plans.follow(enemy, tick, move, { kind: 'pursuit', target: sim.hero });
  assert.equal(routes.mock.callCount(), 1);
  const before = enemy.x;
  plans.follow(enemy, 60, move, { kind: 'pursuit', target: { x: 4, z: 0 } });
  assert.equal(routes.mock.callCount(), 2);
  assert.ok(enemy.x > before, 'a moved destination changes pursuit direction');
});

test('manual enemy routes work before encounter activation and respect stun', () => {
  const sim = new Simulation(content),
    enemy = sim.enemies[0]!,
    start = enemy.x,
    goal = { x: start + 0.3, z: enemy.z };
  assert.equal(sim.engaged, false);
  sim.setMovementTarget(enemy.id, goal);
  enemy.stun = 1;
  sim.step();
  assert.equal(enemy.x, start);
  for (let i = 0; i < 30; i++) sim.step();
  assert.ok(Math.hypot(enemy.x - goal.x, enemy.z - goal.z) < 1e-6);
  assert.equal(enemy.state, 'idle');
  assert.equal(sim.navigationDebug(false).routes.length, 0);
  assert.equal(sim.engaged, false);
  assert.equal(sim.hero.health, sim.maxHealth);
});

test('navigation rejects invalid coordinates and publishes detached coordinate-only waypoints', () => {
  const a = area();
  a.props = [];
  const nav = new Navigation(a),
    goal = { x: 3, z: 1, health: 10, inventory: { gold: 3 } };
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(isSupportedPosition(a, { x: invalid, z: 0 }, 0.3), false);
    assert.equal(nav.route({ x: -3, z: 0 }, { x: invalid, z: 0 }, 0.3).status, 'unreachable');
  }
  const route = nav.route({ x: -3, z: 0 }, goal, 0.3);
  assert.deepEqual(route.points, [{ x: 3, z: 1 }]);
  goal.x = 4;
  assert.deepEqual(route.points, [{ x: 3, z: 1 }]);
});

test('following a route spends the movement budget across corners without cutting them', (t) => {
  const a = area();
  a.props = [];
  const sim = simulate(a),
    hero = sim.hero,
    plans = new MovementPlans(sim.areaDefinition),
    budget = hero.definition.speed / 60;
  Object.assign(hero, { x: 0, z: 0 });
  t.mock.method(Navigation.prototype, 'route', () => ({
    status: 'ready',
    points: [
      { x: budget / 4, z: 0 },
      { x: budget / 4, z: 2 },
    ],
  }));
  plans.setManual(hero, { x: budget / 4, z: 2 }, 0);
  const segments: { x: number; z: number }[] = [];
  plans.follow(hero, 1, (actor, x, z) => {
    segments.push({ x, z });
    sim.move(actor, x, z);
  });
  assert.ok(Math.abs(hero.x - budget / 4) < 1e-8);
  assert.ok(Math.abs(hero.z - (budget * 3) / 4) < 1e-8);
  assert.equal(segments.length, 2, 'movement follows both clear segments, not their diagonal');
  assert.equal(segments[0]!.z, 0);
  assert.equal(segments[1]!.x, 0);
  assert.equal(
    plans.follow(hero, 2, () => {}),
    false,
    'vetoed movement is not walking',
  );
  assert.equal(hero.state, 'idle');
  assert.equal(plans.has(hero.id), true, 'a blocked request retains its destination');
});

test('a reached melee fallback waits for displacement or a moved target before searching again', (t) => {
  const a = area();
  a.props = [];
  const sim = simulate(a),
    enemy = sim.enemies[0]!,
    plans = new MovementPlans(sim.areaDefinition),
    goal = { x: -3, z: 0 },
    fallback = { x: enemy.x - 0.01, z: enemy.z };
  const routes = t.mock.method(
    Navigation.prototype,
    'route',
    (_start: { x: number; z: number }, target: { x: number; z: number }) =>
      target === goal
        ? { status: 'unreachable', points: [] }
        : { status: 'ready', points: [{ ...fallback }] },
  );
  const move = (actor: typeof enemy, x: number, z: number) => sim.move(actor, x, z);
  plans.follow(enemy, 0, move, { kind: 'pursuit', target: goal });
  const searched = routes.mock.callCount();
  for (let tick = 1; tick < 60; tick++)
    plans.follow(enemy, tick, move, { kind: 'pursuit', target: goal });
  assert.equal(
    routes.mock.callCount(),
    searched,
    'the same fallback must not be searched every tick',
  );
  enemy.x += 0.1;
  plans.follow(enemy, 60, move, { kind: 'pursuit', target: goal });
  assert.ok(routes.mock.callCount() > searched);
});
