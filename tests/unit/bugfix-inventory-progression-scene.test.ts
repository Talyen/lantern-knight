import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryState, MAX_ITEM_COUNT } from '../../src/core/inventory';
import { validateUpgrades, kitAttributes, upgradeOffer } from '../../src/content/progression';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';
import { emptyScene } from '../../src/editor/default-scene';

test('InventoryState.award tracks accumulating totals across duplicate rewards', () => {
  const state = new InventoryState();

  // Single award of MAX_ITEM_COUNT succeeds
  state.award([{ item: 'gold', amount: MAX_ITEM_COUNT }]);
  assert.equal(state.inventory.gold, MAX_ITEM_COUNT);

  // Subsequent award exceeding MAX_ITEM_COUNT is rejected
  assert.throws(() => state.award([{ item: 'gold', amount: 1 }]), /Invalid inventory reward/);

  // Multiple rewards in a single award batch that sum over MAX_ITEM_COUNT are rejected
  const fresh = new InventoryState();
  assert.throws(
    () =>
      fresh.award([
        { item: 'gold', amount: MAX_ITEM_COUNT },
        { item: 'gold', amount: 1 },
      ]),
    /Invalid inventory reward/,
  );

  // Cumulative stackable items in a single award batch exceeding MAX_ITEM_COUNT are rejected
  assert.throws(
    () =>
      fresh.award([
        { item: 'iron', amount: MAX_ITEM_COUNT - 5 },
        { item: 'iron', amount: 10 },
      ]),
    /Invalid inventory reward/,
  );

  // Multiple rewards within limits properly accumulate
  fresh.award([
    { item: 'gold', amount: 100 },
    { item: 'gold', amount: 250 },
    { item: 'iron', amount: 3 },
    { item: 'iron', amount: 4 },
  ]);
  assert.equal(fresh.inventory.gold, 350);
  assert.equal(fresh.inventory.iron, 7);
});

test('validateUpgrades rejects non-objects, arrays, and invalid rank types', () => {
  // Null and non-object types must throw
  assert.throws(() => validateUpgrades(null as never), /Unknown upgrade or invalid rank/);
  assert.throws(() => validateUpgrades(123 as never), /Unknown upgrade or invalid rank/);
  assert.throws(() => validateUpgrades(true as never), /Unknown upgrade or invalid rank/);
  assert.throws(() => validateUpgrades('sword' as never), /Unknown upgrade or invalid rank/);
  assert.throws(() => validateUpgrades([] as never), /Unknown upgrade or invalid rank/);

  // kitAttributes propagates non-object rejection
  assert.throws(() => kitAttributes(null as never), /Unknown upgrade or invalid rank/);
  assert.throws(() => kitAttributes(42 as never), /Unknown upgrade or invalid rank/);
  assert.throws(() => kitAttributes([] as never), /Unknown upgrade or invalid rank/);

  // upgradeOffer propagates non-object rejection
  assert.throws(() => upgradeOffer('sword', null as never), /Unknown upgrade or invalid rank/);
  assert.throws(() => upgradeOffer('sword', 42 as never), /Unknown upgrade or invalid rank/);

  // Valid upgrade ranks object succeeds
  assert.doesNotThrow(() => validateUpgrades({}));
  assert.doesNotThrow(() => validateUpgrades({ sword: 1 }));
});

test('SceneDocumentSchema validates geometry entry bounds, stair terrace bounds, and interactable clips', () => {
  const doc = emptyScene();

  // Geometry entry with X outside geometry bounds is rejected
  const outsideEntryDoc: SceneDocument = {
    ...doc,
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: { kind: 'flat', height: 0 },
      baselineEntry: 'start',
      entries: [
        { id: 'start', x: 0, z: 0 },
        { id: 'outside-x', x: 6, z: 0 },
      ],
    },
  };
  assert.throws(
    () => parseSceneDocument(outsideEntryDoc),
    /Geometry entry outside bounds: outside-x/,
  );

  // Geometry entry with Z outside geometry bounds is rejected
  const outsideZEntryDoc: SceneDocument = {
    ...doc,
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: { kind: 'flat', height: 0 },
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: -6 }],
    },
  };
  assert.throws(() => parseSceneDocument(outsideZEntryDoc), /Geometry entry outside bounds: start/);

  // Stair terraceBounds extending outside geometry bounds is rejected
  const outsideTerraceDoc: SceneDocument = {
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
        steps: 3,
        terraceBounds: { minX: -5, maxX: 6, minZ: -5, maxZ: 5 },
      },
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 0 }],
    },
  };
  assert.throws(
    () => parseSceneDocument(outsideTerraceDoc),
    /Stair terrace bounds outside geometry bounds/,
  );

  // Interactable with empty clip name is rejected
  const emptyClipDoc: SceneDocument = {
    ...doc,
    objects: [
      {
        id: 'chest-prop',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        x: 0,
        z: 0,
      },
    ],
    gameplay: {
      spawns: [],
      exits: [],
      pickups: [],
      interactables: [
        {
          id: 'test-chest',
          object: 'chest-prop',
          kind: 'container',
          x: 0,
          z: 0,
          rewards: [{ item: 'gold', amount: 10 }],
          idle: '',
          action: 'open',
          spent: 'opened',
        },
      ],
    },
  };
  assert.throws(() => parseSceneDocument(emptyClipDoc));

  // Valid geometry with in-bounds entries and terrace bounds succeeds
  const validDoc: SceneDocument = {
    ...doc,
    objects: [
      {
        id: 'chest-prop',
        asset: 'ink-crypt',
        clip: 'still',
        kind: 'prop',
        x: 0,
        z: 0,
      },
    ],
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: {
        kind: 'stairs',
        axis: 'x',
        start: -2,
        end: 2,
        startHeight: 0,
        endHeight: 1,
        steps: 3,
        terraceBounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
      },
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 0 }],
    },
    gameplay: {
      spawns: [],
      exits: [],
      pickups: [],
      interactables: [
        {
          id: 'test-chest',
          object: 'chest-prop',
          kind: 'container',
          x: 0,
          z: 0,
          rewards: [{ item: 'gold', amount: 10 }],
          idle: 'closed',
          action: 'open',
          spent: 'opened',
        },
      ],
    },
  };
  assert.doesNotThrow(() => parseSceneDocument(validDoc));
});
