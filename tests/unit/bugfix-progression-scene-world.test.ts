import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';
import { upgradeOffer, type UpgradeId } from '../../src/content/progression';
import { emptyScene } from '../../src/editor/default-scene';
import { contentDefinitions } from '../fixtures/content';

const baseArea = (): AreaDefinition =>
  ({
    ...structuredClone(contentDefinitions.areas[0]!),
    id: 'bugfix-area',
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

test('upgradeOffer validates upgrade ranks and rejects invalid or out-of-range ranks', () => {
  // Rank exceeding maximum authored ranks must throw
  assert.throws(() => upgradeOffer('sword', { sword: 2 }), /Unknown upgrade or invalid rank/);

  // Negative ranks must throw
  assert.throws(() => upgradeOffer('sword', { sword: -1 }), /Unknown upgrade or invalid rank/);

  // Zero rank must throw
  assert.throws(() => upgradeOffer('sword', { sword: 0 }), /Unknown upgrade or invalid rank/);

  // Non-integer rank must throw
  assert.throws(() => upgradeOffer('sword', { sword: 1.5 }), /Unknown upgrade or invalid rank/);

  // Unknown upgrade ID in ranks must throw
  assert.throws(
    () => upgradeOffer('sword', { badUpgrade: 1 } as never),
    /Unknown upgrade or invalid rank/,
  );

  // Unknown requested upgrade ID throws Unknown upgrade
  assert.throws(() => upgradeOffer('bow' as UpgradeId), /Unknown upgrade/);

  // Baseline offer without parameters returns rank 0 and material cost
  const baseline = upgradeOffer('sword');
  assert.equal(baseline.rank, 0);
  assert.equal(baseline.next?.percent, 200);
  assert.match(baseline.reason ?? '', /Requires/);

  // When materials are owned, reason is undefined
  const affordable = upgradeOffer('sword', {}, { gold: 20, iron: 4 });
  assert.equal(affordable.rank, 0);
  assert.equal(affordable.reason, undefined);

  // Maximum rank reached
  const maxed = upgradeOffer('sword', { sword: 1 });
  assert.equal(maxed.rank, 1);
  assert.equal(maxed.next, undefined);
  assert.equal(maxed.reason, 'Maximum rank reached');
});

test('SceneDocumentSchema validates attachment mounts and rejects self-mounts, missing supports, and cycles', () => {
  const doc = emptyScene();

  // Self-mount allowance (p.mount.to === p.id) is rejected
  const selfMountDoc: SceneDocument = {
    ...doc,
    objects: [
      {
        id: 'altar-votive',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        role: 'attachment',
        mount: { to: 'altar-votive', offset: [0, 1, 0] },
      },
    ],
  };
  assert.throws(
    () => parseSceneDocument(selfMountDoc),
    /Object cannot mount to itself: altar-votive/,
  );

  // Mounted object referencing missing support is rejected
  const missingSupportDoc: SceneDocument = {
    ...doc,
    objects: [
      {
        id: 'candles',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        role: 'attachment',
        mount: { to: 'nonexistent-support', offset: [0, 1, 0] },
      },
    ],
  };
  assert.throws(
    () => parseSceneDocument(missingSupportDoc),
    /Missing attachment support: nonexistent-support/,
  );

  // Cyclic attachment support is rejected
  const cycleDoc: SceneDocument = {
    ...doc,
    objects: [
      {
        id: 'mount-a',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        role: 'attachment',
        mount: { to: 'mount-b', offset: [0, 1, 0] },
      },
      {
        id: 'mount-b',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        role: 'attachment',
        mount: { to: 'mount-a', offset: [0, 1, 0] },
      },
    ],
  };
  assert.throws(() => parseSceneDocument(cycleDoc), /Cyclic attachment support/);

  // Overlap allowance with empty reason is rejected
  const emptyReasonDoc: SceneDocument = {
    ...doc,
    overlaps: [
      {
        a: 'pillar-1',
        b: 'pillar-2',
        region: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
        reason: '   ',
      },
    ],
  };
  assert.throws(() => parseSceneDocument(emptyReasonDoc));

  // Surface with steps exceeding authored maximum 12 is rejected
  const excessiveStepsDoc: SceneDocument = {
    ...doc,
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: {
        kind: 'stairs',
        axis: 'x',
        start: -2,
        end: 2,
        startHeight: 0,
        endHeight: 1,
        steps: 13,
      },
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 0 }],
    },
  };
  assert.throws(() => parseSceneDocument(excessiveStepsDoc));

  // Surface with slope exceeding 0.5 is rejected
  const steepRampDoc: SceneDocument = {
    ...doc,
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: {
        kind: 'ramp',
        axis: 'x',
        start: 0,
        end: 2,
        startHeight: 0,
        endHeight: 2, // slope = 2 / 2 = 1.0 > 0.5
      },
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 0 }],
    },
  };
  assert.throws(() => parseSceneDocument(steepRampDoc), /Ramp slope cannot exceed 0.5/);

  // Valid attachment mount succeeds
  const validMountDoc: SceneDocument = {
    ...doc,
    objects: [
      {
        id: 'altar-table',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        x: 0,
        z: 0,
      },
      {
        id: 'altar-candles',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        role: 'attachment',
        mount: { to: 'altar-table', offset: [0, 1, 0] },
      },
    ],
  };
  assert.doesNotThrow(() => parseSceneDocument(validMountDoc));
});

test('assertArea and assertActor reject outside terrace bounds and non-finite rib lanes', () => {
  // Rib-lane with non-finite length is rejected with non-finite value
  const badRibLane = {
    ...structuredClone(contentDefinitions.actors[0]!),
    id: 'nan-rib-lane-actor',
    kind: 'enemy' as const,
    attack: {
      kind: 'rib-lane' as const,
      windup: 10,
      activeEnd: 20,
      total: 30,
      range: 5,
      damage: 10,
      length: NaN,
      width: 2,
      cooldown: 40,
    },
  };
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        actors: [...contentDefinitions.actors, badRibLane],
      }),
    /non-finite value/,
  );

  // Terrace bounds outside bounds must be rejected
  const outsideTerrace = baseArea();
  outsideTerrace.surface = {
    kind: 'stairs',
    axis: 'x',
    start: -2,
    end: 2,
    startHeight: 0,
    endHeight: 1,
    steps: 3,
    terraceBounds: { minX: -5, maxX: 12, minZ: -5, maxZ: 5 }, // maxX 12 > bounds maxX 10
  };
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: outsideTerrace.id,
        areas: [outsideTerrace],
      }),
    /terrace outside bugfix-area/,
  );

  // Valid area with campfire and within-bounds terrace succeeds
  const validArea = baseArea();
  validArea.entries = [
    { id: 'start', x: 0, z: 0 },
    { id: 'fire-rest', x: 2, z: 2 },
  ];
  validArea.campfires = [
    {
      id: 'rest',
      name: 'Rest Campfire',
      x: 2.5,
      z: 2.5,
      safeRadius: 3,
    },
  ];
  assert.doesNotThrow(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: validArea.id,
        areas: [validArea],
      }),
  );
});
