import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Navigation, moveSupported, clearSegment } from '../../src/core/navigation';
import { ContentRegistry, isSupportedPosition, type AreaDefinition } from '../../src/content/world';
import { Simulation } from '../../src/core/simulation';
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
