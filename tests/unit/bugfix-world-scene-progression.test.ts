import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';
import { kitAttributes } from '../../src/content/progression';
import { emptyScene } from '../../src/editor/default-scene';
import { contentDefinitions } from '../fixtures/content';

const baseArea = (): AreaDefinition =>
  ({
    ...structuredClone(contentDefinitions.areas[0]!),
    id: 'bugfix-world-area',
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    playableBoundary: undefined,
    activation: undefined,
    entries: [{ id: 'start', x: 0, z: 0 }],
    baselineEntry: 'start',
    spawns: [{ id: 'enemy', actor: 'skeleton', x: 2, z: 2 }],
    exits: [],
    props: [],
    pickups: [],
    floorColor: 0x334455,
  }) as AreaDefinition;

test('assertArea validates pickup amount and radius within authored limits', () => {
  // Amount exceeding 1000 must be rejected
  const overflowAmount = baseArea();
  overflowAmount.pickups = [
    { id: 'p1', object: 'obj-1', kind: 'health', x: 0, z: 0, amount: 1001, radius: 0.5 },
  ];
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: overflowAmount.id,
        areas: [overflowAmount],
      }),
    /invalid pickup p1/,
  );

  // Radius exceeding 10 must be rejected
  const overflowRadius = baseArea();
  overflowRadius.pickups = [
    { id: 'p2', object: 'obj-2', kind: 'health', x: 0, z: 0, amount: 50, radius: 10.5 },
  ];
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: overflowRadius.id,
        areas: [overflowRadius],
      }),
    /invalid pickup p2/,
  );

  // Valid pickup amount (<= 1000) and radius (<= 10) passes
  const validPickup = baseArea();
  validPickup.pickups = [
    { id: 'p3', object: 'obj-3', kind: 'health', x: 0, z: 0, amount: 1000, radius: 10 },
  ];
  assert.doesNotThrow(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: validPickup.id,
        areas: [validPickup],
      }),
  );
});

test('SceneDocumentSchema distinguishes interactables from pickups and rejects self-overlaps', () => {
  const doc = emptyScene();

  // Missing artwork on an interactable reports Interactable error, not Pickup error
  const interactableDoc: SceneDocument = {
    ...doc,
    gameplay: {
      spawns: [],
      exits: [],
      pickups: [],
      interactables: [
        {
          id: 'chest-1',
          object: 'missing-chest-artwork',
          kind: 'container',
          x: 0,
          z: 0,
          rewards: [{ item: 'gold', amount: 10 }],
          idle: 'chest_closed',
          action: 'chest_opening',
          spent: 'chest_open',
        },
      ],
    },
  };
  assert.throws(
    () => parseSceneDocument(interactableDoc),
    /Interactable references missing upright artwork: missing-chest-artwork/,
  );

  // Missing artwork on a pickup reports Pickup error
  const pickupDoc: SceneDocument = {
    ...doc,
    gameplay: {
      spawns: [],
      exits: [],
      pickups: [
        {
          id: 'health-1',
          object: 'missing-health-artwork',
          kind: 'health',
          x: 0,
          z: 0,
          amount: 25,
          radius: 1,
        },
      ],
    },
  };
  assert.throws(
    () => parseSceneDocument(pickupDoc),
    /Pickup references missing upright artwork: missing-health-artwork/,
  );

  // Self-overlap allowance (a === b) is rejected
  const selfOverlapDoc: SceneDocument = {
    ...doc,
    overlaps: [
      {
        a: 'pillar-1',
        b: 'pillar-1',
        region: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
        reason: 'intentional overlap',
      },
    ],
  };
  assert.throws(
    () => parseSceneDocument(selfOverlapDoc),
    /Self-overlap allowance: a and b must be distinct: pillar-1/,
  );

  // Distinct overlap allowance passes schema parse
  const distinctOverlapDoc: SceneDocument = {
    ...doc,
    overlaps: [
      {
        a: 'pillar-1',
        b: 'pillar-2',
        region: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
        reason: 'intentional overlap',
      },
    ],
  };
  assert.doesNotThrow(() => parseSceneDocument(distinctOverlapDoc));
});

test('kitAttributes validates upgrade ranks and rejects invalid or out-of-range ranks', () => {
  // Rank exceeding maximum authored ranks must throw
  assert.throws(() => kitAttributes({ sword: 2 }), /Unknown upgrade or invalid rank/);

  // Negative ranks must throw
  assert.throws(() => kitAttributes({ sword: -1 }), /Unknown upgrade or invalid rank/);

  // Zero rank must throw
  assert.throws(() => kitAttributes({ sword: 0 }), /Unknown upgrade or invalid rank/);

  // Non-integer rank must throw
  assert.throws(() => kitAttributes({ sword: 1.5 }), /Unknown upgrade or invalid rank/);

  // Unknown upgrade ID must throw
  assert.throws(
    () => kitAttributes({ invalidUpgrade: 1 } as never),
    /Unknown upgrade or invalid rank/,
  );

  // Default empty ranks succeed with baseline attributes
  assert.deepEqual(kitAttributes(), { edge: 100, ember: 100 });
  assert.deepEqual(kitAttributes({}), { edge: 100, ember: 100 });

  // Valid upgrade ranks return scaled kit attributes
  assert.deepEqual(kitAttributes({ sword: 1 }), { edge: 200, ember: 100 });
  assert.deepEqual(kitAttributes({ lantern: 1 }), { edge: 100, ember: 200 });
  assert.deepEqual(kitAttributes({ sword: 1, lantern: 1 }), { edge: 200, ember: 200 });
});
