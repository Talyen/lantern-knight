import test from 'node:test';
import assert from 'node:assert/strict';
import { items, type ItemDefinition } from '../../src/content/items';
import { InventoryState } from '../../src/core/inventory';
import { StorageCodec } from '../../src/platform/storage-codec';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';
import { emptyScene } from '../../src/editor/default-scene';
import { ContentRegistry } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';
import { GameSession } from '../../src/core/session';

test('inventory salvage routes gold outputs to wallet instead of invalid pack entries', () => {
  const customItem = 'gold-trinket-scrap';
  (items as Record<string, ItemDefinition>)[customItem] = {
    footprint: [1, 1],
    stackable: false,
    name: 'Gold Trinket Scrap',
    kind: 'salvage',
    salvage: { gold: 25, iron: 2 },
  };

  try {
    const state = new InventoryState({
      inventory: { [customItem]: 2, gold: 5 },
      equipment: {},
    });
    assert.equal(state.inventory.gold, 5);
    assert.equal(state.inventory[customItem], 2);

    // Salvaging should credit 50 gold (25 * 2) directly to wallet and add 4 iron (2 * 2) to pack
    const changed = state.change({ kind: 'salvage', item: customItem });
    assert.equal(changed, true);
    assert.equal(state.inventory.gold, 55);
    assert.equal(state.inventory.iron, 4);
    assert.equal(state.inventory[customItem], 0);

    // Pack must only contain non-gold entries
    for (const entry of state.pack) {
      assert.notEqual(entry.item, 'gold');
    }
  } finally {
    delete (items as Record<string, ItemDefinition>)[customItem];
  }
});

test('StorageCodec decode distinguishes incompatible versions from malformed or unversioned data', () => {
  const registry = new ContentRegistry(contentDefinitions);
  const codec = new StorageCodec(registry);
  const session = new GameSession(registry);
  const save = session.captureSave();

  // Explicit incompatible versions report { status: 'empty', reason: 'incompatible' }
  const v10 = JSON.stringify({ ...save, version: 10 });
  assert.deepEqual(codec.decode('game', v10), { status: 'empty', reason: 'incompatible' });
  const v5 = JSON.stringify({ ...save, version: 5 });
  assert.deepEqual(codec.decode('game', v5), { status: 'empty', reason: 'incompatible' });

  // Malformed or unversioned payloads report { status: 'empty' } without claiming incompatibility
  assert.deepEqual(codec.decode('game', '{}'), { status: 'empty' });
  assert.deepEqual(codec.decode('game', '123'), { status: 'empty' });
  assert.deepEqual(codec.decode('game', '"text"'), { status: 'empty' });
  assert.deepEqual(codec.decode('game', 'null'), { status: 'empty' });
  assert.deepEqual(codec.decode('game', JSON.stringify({ area: 'court' })), { status: 'empty' });

  // Valid version 11 data decodes successfully
  const valid = codec.decode('game', JSON.stringify(save));
  assert.equal(valid.status, 'ok');
  if (valid.status === 'ok') {
    assert.equal(valid.data.version, 11);
  }
});

test('SceneDocumentSchema rejects duplicate wall/grave identities and invalid geometry entries', () => {
  const doc = emptyScene();

  // Duplicate wall IDs are rejected
  const dupWallsDoc: SceneDocument = {
    ...doc,
    walls: [
      { id: 'wall-1', from: { x: 0, z: 0 }, to: { x: 2, z: 0 }, height: 2, thickness: 0.2 },
      { id: 'wall-1', from: { x: 0, z: 2 }, to: { x: 2, z: 2 }, height: 2, thickness: 0.2 },
    ],
  };
  assert.throws(() => parseSceneDocument(dupWallsDoc), /Duplicate wall identity/);

  // Duplicate grave IDs are rejected
  const dupGravesDoc: SceneDocument = {
    ...doc,
    graves: [
      { id: 'grave-1', x: 0, z: 0, width: 1, length: 2, age: 'old' },
      { id: 'grave-1', x: 2, z: 0, width: 1, length: 2, age: 'old' },
    ],
  };
  assert.throws(() => parseSceneDocument(dupGravesDoc), /Duplicate grave identity/);

  // Duplicate geometry entry IDs are rejected
  const dupEntriesDoc: SceneDocument = {
    ...doc,
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: { kind: 'flat', height: 0 },
      baselineEntry: 'entry-1',
      entries: [
        { id: 'entry-1', x: 0, z: 0 },
        { id: 'entry-1', x: 1, z: 1 },
      ],
    },
  };
  assert.throws(() => parseSceneDocument(dupEntriesDoc), /Duplicate geometry entry identity/);

  // Missing baselineEntry in geometry entries is rejected
  const missingBaselineDoc: SceneDocument = {
    ...doc,
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: { kind: 'flat', height: 0 },
      baselineEntry: 'missing-baseline',
      entries: [{ id: 'entry-1', x: 0, z: 0 }],
    },
  };
  assert.throws(
    () => parseSceneDocument(missingBaselineDoc),
    /Scene baseline entry must match one of its geometry entries/,
  );

  // Valid scene document with unique walls, graves, and geometry entries passes
  const validDoc: SceneDocument = {
    ...doc,
    walls: [
      { id: 'wall-1', from: { x: 0, z: 0 }, to: { x: 2, z: 0 }, height: 2, thickness: 0.2 },
      { id: 'wall-2', from: { x: 0, z: 2 }, to: { x: 2, z: 2 }, height: 2, thickness: 0.2 },
    ],
    graves: [
      { id: 'grave-1', x: 0, z: 0, width: 1, length: 2, age: 'old' },
      { id: 'grave-2', x: 2, z: 0, width: 1, length: 2, age: 'old' },
    ],
    geometry: {
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      surface: { kind: 'flat', height: 0 },
      baselineEntry: 'entry-1',
      entries: [
        { id: 'entry-1', x: 0, z: 0 },
        { id: 'entry-2', x: 1, z: 1 },
      ],
    },
  };
  assert.doesNotThrow(() => parseSceneDocument(validDoc));
});
