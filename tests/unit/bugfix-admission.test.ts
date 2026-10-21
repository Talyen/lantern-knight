import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptCommand } from '../../src/core/command';
import { isValidCampfireEntry, type AreaDefinition } from '../../src/content/world';
import { ContentRegistry } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';
import { boxProp } from '../fixtures/world';

const baseArea = (): AreaDefinition =>
  ({
    ...structuredClone(contentDefinitions.areas[0]!),
    id: 'bugfix-admission',
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    playableBoundary: undefined,
    activation: undefined,
    entries: [{ id: 'start', x: -3, z: 0 }],
    baselineEntry: 'start',
    spawns: [{ id: 'enemy', actor: 'skeleton', x: 3, z: 0 }],
    exits: [],
    props: [],
  }) as AreaDefinition;

test('zero-area polygon props are rejected instead of producing inverted normals', () => {
  const a = baseArea();
  a.props = [
    {
      id: 'flat',
      kind: 'wall',
      x: 0,
      z: 0,
      radius: 0.2,
      height: 1,
      shape: 'polygon',
      polygon: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 2, z: 0 },
      ],
    },
  ];
  assert.throws(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
    /invalid terrain polygon/,
  );
  // A real triangle still admits.
  const valid = baseArea();
  valid.props = [
    {
      id: 'solid',
      kind: 'wall',
      x: 0,
      z: 0,
      radius: 0.2,
      height: 1,
      shape: 'polygon',
      polygon: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 0, z: 1 },
      ],
    },
  ];
  valid.spawns = [];
  valid.entries = [{ id: 'start', x: -3, z: 0 }];
  assert.doesNotThrow(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: valid.id, areas: [valid] }),
  );
});

test('campfire arrival uses actor clearance so a near-miss wall blocks the entry', () => {
  const area = {
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    surface: { kind: 'flat', height: 0 },
    props: [boxProp({ id: 'sliver', x: 0.5, z: 0.2, size: [0.2, 0.2] })],
  } as unknown as AreaDefinition;
  const fire = { x: 0, z: 0, safeRadius: 2.6 };
  // Offset prop sits 0.1 off the arrival line: clear for a 0.001 point probe,
  // but inside the 0.3 hero clearance, so the entry must be refused.
  assert.equal(isValidCampfireEntry(area, fire, { x: 1, z: 0 }), false);
  // Open ground still admits.
  const open = {
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    surface: { kind: 'flat', height: 0 },
    props: [],
  } as unknown as AreaDefinition;
  assert.equal(isValidCampfireEntry(open, fire, { x: 1, z: 0 }), true);
});

test('acceptCommand validates actions/potion and detaches caller memory', () => {
  const fallback = { x: 0, z: 1 };
  const move = { x: 0.5, z: 0 };
  const aim = { x: 1, z: 2 };
  const actions = ['sword', 'nuke', 'lantern'] as never[];
  const accepted = acceptCommand(
    { move, aim, actions: actions as never, potion: 1 as never },
    3,
    fallback,
  );
  // Unknown actions are dropped instead of falling through to ability/Dodge labels.
  assert.deepEqual(accepted.actions, ['sword', 'lantern']);
  // Truthy non-booleans cannot consume a potion.
  assert.equal(accepted.potion, false);
  assert.equal(acceptCommand({ move, aim, potion: true }, 3, fallback).potion, true);
  // Admitted data is a copy: later caller edits cannot steer the simulation.
  move.x = 9;
  aim.x = 9;
  actions.push('dodge' as never);
  fallback.x = 9;
  assert.deepEqual(accepted.move, { x: 0.5, z: 0 });
  assert.deepEqual(accepted.aim, { x: 1, z: 2 });
  assert.deepEqual(accepted.actions, ['sword', 'lantern']);
  // Mutating the result cannot rewrite caller state either.
  const sourceMove = { x: 0.2, z: 0 };
  const sourceAim = { x: 0, z: 0 };
  const out = acceptCommand({ move: sourceMove, aim: sourceAim }, 3, fallback);
  out.move.x = 7;
  out.aim.z = 7;
  (out.actions as unknown as string[]).push('sword');
  assert.deepEqual(sourceMove, { x: 0.2, z: 0 });
  assert.deepEqual(sourceAim, { x: 0, z: 0 });
  // Stale generations stay inert without aliasing the fallback.
  const stale = acceptCommand({ move, aim, generation: 2 }, 3, { x: 4, z: 5 });
  assert.deepEqual(stale, {
    move: { x: 0, z: 0 },
    aim: { x: 4, z: 5 },
    actions: [],
    potion: false,
  });
  assert.notEqual(stale.aim, fallback);
});
