import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContentRegistry,
  type AreaDefinition,
  type ActorDefinition,
} from '../../src/content/world';
import { GameSession } from '../../src/core/session';
import { clampPackCell } from '../../src/core/pack';
import { contentDefinitions } from '../fixtures/content';

const baseArea = (): AreaDefinition =>
  ({
    ...structuredClone(contentDefinitions.areas[0]!),
    id: 'bugfix-world-session',
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    playableBoundary: undefined,
    activation: undefined,
    entries: [{ id: 'start', x: -3, z: 0 }],
    baselineEntry: 'start',
    spawns: [{ id: 'enemy', actor: 'skeleton', x: 3, z: 0 }],
    exits: [],
    props: [],
  }) as AreaDefinition;

test('assertActor rejects invalid actor kinds', () => {
  const badActor: ActorDefinition = {
    ...structuredClone(contentDefinitions.actors[0]!),
    id: 'bad-actor',
    kind: 'npc' as never,
  };
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        actors: [...contentDefinitions.actors, badActor],
      }),
    /invalid actor bad-actor/,
  );
});

test('assertArea rejects invalid prop kind and non-boolean blocking', () => {
  const badKind = baseArea();
  badKind.props = [
    {
      id: 'prop-invalid-kind',
      kind: 'crystal' as never,
      x: 0,
      z: 0,
      radius: 0.5,
      height: 1,
    },
  ];
  assert.throws(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: badKind.id, areas: [badKind] }),
    /invalid prop kind prop-invalid-kind/,
  );

  const badBlocking = baseArea();
  badBlocking.props = [
    {
      id: 'prop-bad-blocking',
      kind: 'pillar',
      x: 0,
      z: 0,
      radius: 0.5,
      height: 1,
      blocking: 'true' as never,
    },
  ];
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: badBlocking.id,
        areas: [badBlocking],
      }),
    /invalid prop blocking prop-bad-blocking/,
  );
});

test('assertArea rejects invalid stair width', () => {
  const badStairs = baseArea();
  badStairs.surface = {
    kind: 'stairs',
    axis: 'x',
    start: -2,
    end: 2,
    startHeight: 0,
    endHeight: 1,
    steps: 3,
    stairWidth: -1,
  };
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: badStairs.id,
        areas: [badStairs],
      }),
    /invalid stair width/,
  );
});

test('GameSession.fire safely reports Unknown campfire for nonexistent areas', () => {
  const registry = new ContentRegistry(contentDefinitions);
  const session = new GameSession(registry, 1, registry.definitions.initialArea, 0);

  // Unknown area part of campfire key throws Unknown campfire
  assert.throws(() => session.fire('nonexistent-area/fire'), /Unknown campfire/);
  // Malformed campfire key throws Unknown campfire
  assert.throws(() => session.fire('bad-key'), /Unknown campfire/);
  assert.throws(() => session.fire('area/id/extra'), /Unknown campfire/);
});

test('clampPackCell handles NaN and non-finite coordinates safely', () => {
  // Valid finite coordinates clamp to pack boundaries
  const normal = clampPackCell('gatherers-seal', 2, 3);
  assert.equal(normal.x, 2);
  assert.equal(normal.y, 3);

  // NaN coordinates default safely to 0 instead of propagating NaN
  const nanCoord = clampPackCell('gatherers-seal', NaN, NaN);
  assert.equal(nanCoord.x, 0);
  assert.equal(nanCoord.y, 0);

  // Infinity clamps safely
  const infCoord = clampPackCell('gatherers-seal', Infinity, -Infinity);
  assert.equal(infCoord.x, 11); // packColumns (12) - width (1)
  assert.equal(infCoord.y, 0);
});
