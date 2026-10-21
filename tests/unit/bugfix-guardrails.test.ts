import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';
import { InventoryState } from '../../src/core/inventory';
import { StorageCodec, type Slot } from '../../src/platform/storage-codec';

const baseArea = (): AreaDefinition =>
  ({
    ...structuredClone(contentDefinitions.areas[0]!),
    id: 'bugfix-guardrails',
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    playableBoundary: undefined,
    activation: undefined,
    entries: [{ id: 'start', x: -3, z: 0 }],
    baselineEntry: 'start',
    spawns: [{ id: 'enemy', actor: 'skeleton', x: 3, z: 0 }],
    exits: [],
    props: [],
  }) as AreaDefinition;

test('assertArea rejects box props without a 2-element size tuple and rejects unknown prop shapes', () => {
  const a = baseArea();
  // 1-element size array must be rejected
  a.props = [
    {
      id: 'bad-box',
      kind: 'wall',
      x: 0,
      z: 0,
      radius: 0.2,
      height: 1,
      shape: 'box',
      size: [2] as unknown as [number, number],
    },
  ];
  assert.throws(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: a.id, areas: [a] }),
    /box footprint requires size \[width, length\]/,
  );

  // Unknown shape must be rejected
  const b = baseArea();
  b.props = [
    {
      id: 'bad-shape',
      kind: 'wall',
      x: 0,
      z: 0,
      radius: 0.2,
      height: 1,
      shape: 'cylinder' as never,
    },
  ];
  assert.throws(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: b.id, areas: [b] }),
    /invalid prop shape bad-shape/,
  );

  // A valid box prop still admits
  const valid = baseArea();
  valid.props = [
    {
      id: 'good-box',
      kind: 'wall',
      x: 0,
      z: 0,
      radius: 0.2,
      height: 1,
      shape: 'box',
      size: [2, 2],
    },
  ];
  assert.doesNotThrow(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: valid.id, areas: [valid] }),
  );
});

test('InventoryState.change rejects unknown command kinds instead of executing salvage', () => {
  const state = new InventoryState({
    inventory: { 'damaged-axe': 1 },
    equipment: {},
    pack: [{ key: 'entry-1', item: 'damaged-axe', quantity: 1, x: 0, y: 0 }],
  });

  // An unknown command must throw rather than salvaging the damaged-axe into iron
  assert.throws(
    () => state.change({ kind: 'discard' } as never),
    /Unknown inventory command: discard/,
  );
  // Damaged axe remains unsalvaged in pack
  assert.equal(state.pack.length, 1);
  assert.equal(state.pack[0]!.item, 'damaged-axe');
  assert.equal(state.inventory['damaged-axe'], 1);
  assert.equal(state.inventory.iron ?? 0, 0);

  // Valid salvage command still succeeds
  const changed = state.change({ kind: 'salvage', item: 'damaged-axe' });
  assert.equal(changed, true);
  assert.equal(state.pack.length, 1);
  assert.equal(state.pack[0]!.item, 'iron');
  assert.equal(state.inventory.iron, 2);
});

test('StorageCodec.decode throws for unknown slots instead of returning empty status', () => {
  const registry = new ContentRegistry(contentDefinitions);
  const codec = new StorageCodec(registry);

  // Unknown slot must throw consistent with snapshot and parse
  assert.throws(
    () => codec.decode('unknown' as Slot, JSON.stringify({ version: 1 })),
    /Unknown app-owned slot/,
  );

  // Known slots still decode properly
  const settingsResult = codec.decode('settings', JSON.stringify({ version: 7, uiScale: 1 }));
  // Missing properties in settings cause empty status, not thrown error
  assert.equal(settingsResult.status, 'empty');
});
