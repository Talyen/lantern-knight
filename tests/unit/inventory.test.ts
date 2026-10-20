import { Simulation } from '../../src/core/simulation';
import { content } from '../fixtures/content';
import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryState, MAX_ITEM_COUNT } from '../../src/core/inventory';
import { packFits, type PackEntry } from '../../src/core/pack';

test('inventory admission and exports detach state; commands enforce owned equipment copies', () => {
  const draft = { inventory: { 'orchard-ring': 1 }, equipment: {} };
  const owner = new InventoryState(draft);
  draft.inventory['orchard-ring'] = 5;
  owner.change({ kind: 'equip', item: 'orchard-ring', slot: 'ring1' });
  const before = owner.snapshot();
  assert.throws(
    () => owner.change({ kind: 'equip', item: 'orchard-ring', slot: 'ring2' }),
    /not owned/,
  );
  assert.deepEqual(owner.snapshot(), before);
  assert.equal(owner.healthBonus, 10);
  before.inventory['orchard-ring'] = 3;
  delete before.equipment.ring1;
  assert.equal(owner.inventory['orchard-ring'], 1);
  assert.equal(owner.equipment.ring1, 'orchard-ring');
  owner.change({ kind: 'unequip', slot: 'ring1' });
  owner.change({ kind: 'equip', item: 'orchard-ring', slot: 'ring2' });
  assert.equal(owner.healthBonus, 10);
});

test('reward batches validate before committing any item and cannot overflow save limits', () => {
  const owner = new InventoryState({ inventory: { gold: MAX_ITEM_COUNT }, equipment: {} });
  const before = owner.snapshot();
  assert.throws(
    () =>
      owner.award([
        { item: 'iron', amount: 2 },
        { item: 'gold', amount: 1 },
      ]),
    /inventory/,
  );
  assert.deepEqual(owner.snapshot(), before);
  assert.throws(
    () =>
      owner.award([
        { item: 'iron', amount: 2 },
        { item: 'constructor', amount: 1 },
      ]),
    /reward/,
  );
  assert.deepEqual(owner.snapshot(), before);
  assert.equal(owner.consume('health-potion'), false);
  owner.award([{ item: 'health-potion', amount: 1 }]);
  assert.equal(owner.consume('health-potion'), true);
  assert.equal(owner.consume('health-potion'), false);
  assert.equal(owner.inventory['health-potion'], 0);
});

test('a newly populated hero starts at the health granted by its owned equipment', () => {
  const inventory = new InventoryState({
    inventory: { 'orchard-ring': 1 },
    equipment: { ring1: 'orchard-ring' },
  });
  const sim = new Simulation(
    content,
    142,
    content.definitions.initialArea,
    1,
    undefined,
    inventory,
  );
  assert.equal(sim.hero.health, sim.maxHealth);
  sim.hero.health = 1;
  sim.populate();
  assert.equal(sim.hero.health, sim.maxHealth);
});

test('sized inventory retains separate gear, supply stacks and manual positions through snapshots', () => {
  const owner = new InventoryState({
    inventory: { sword: 2, 'orchard-ring': 2, 'health-potion': 8, iron: 12 },
    equipment: { sword: 'sword' },
  });
  assert.equal(owner.pack.filter((entry) => entry.item === 'orchard-ring').length, 2);
  assert.equal(owner.pack.find((entry) => entry.item === 'health-potion')!.quantity, 8);
  const sword = owner.pack.find((entry) => entry.item === 'sword')!;
  owner.change({ kind: 'move', entry: sword.key, x: 10, y: 12 });
  const snapshot = owner.snapshot();
  assert.deepEqual(new InventoryState(snapshot).snapshot(), snapshot);
  assert.equal(owner.pack.find((entry) => entry.key === sword.key)!.y, 12);
  snapshot.pack![0]!.x = -1;
  assert.notDeepEqual(owner.snapshot(), snapshot);
  const before = owner.snapshot();
  assert.throws(() => owner.change({ kind: 'move', entry: sword.key, x: 11, y: 15 }), /blocked/);
  assert.deepEqual(owner.snapshot(), before);
  owner.change({ kind: 'organize' });
  for (const entry of owner.pack) assert.equal(packFits(owner.pack, entry, entry.x, entry.y), true);
  assert.equal(Object.isFrozen(owner.pack[0]), true);
});

test('a full pack rejects complete reward batches and unequipping without losing anything', () => {
  const owner = new InventoryState({
    inventory: { 'orchard-ring': 192, sword: 1 },
    equipment: { sword: 'sword' },
  });
  const before = owner.snapshot();
  assert.throws(
    () =>
      owner.award([
        { item: 'gold', amount: 10 },
        { item: 'iron', amount: 1 },
      ]),
    /pack is full/,
  );
  assert.deepEqual(owner.snapshot(), before);
  assert.throws(() => owner.change({ kind: 'unequip', slot: 'sword' }), /pack is full/);
  assert.deepEqual(owner.snapshot(), before);
  // Equipping a carried ring frees exactly one cell; merging a supply stack
  // does not need another cell, even when the pack is otherwise full.
  owner.change({ kind: 'equip', item: 'orchard-ring', slot: 'ring1', entry: owner.pack[0]!.key });
  owner.award([{ item: 'iron', amount: 1 }]);
  owner.award([{ item: 'iron', amount: 5 }]);
  assert.equal(owner.inventory.iron, 6);
  assert.equal(owner.pack.length, 192);
});

test('full-pack unequip and malformed placement admission preserve ownership', () => {
  const owner = new InventoryState({
    inventory: { 'orchard-ring': 191, amulet: 1, 'leather-armor': 1 },
    equipment: { body: 'leather-armor' },
  });
  // Unequipping body armor cannot use the one-cell amulet's occupied space.
  const before = owner.snapshot();
  assert.throws(() => owner.change({ kind: 'unequip', slot: 'body' }), /pack is full/);
  assert.deepEqual(owner.snapshot(), before);
  assert.throws(
    () =>
      new InventoryState({
        ...before,
        pack: before.pack!.map((entry) => ({ ...entry, x: 0, y: 0 })),
      }),
    /placement/,
  );
  assert.throws(() => new InventoryState({ ...before, pack: before.pack!.slice(1) }), /ownership/);
});

test('full-pack pickup failure preserves every reward in a multi-reward ground drop', () => {
  const owner = new InventoryState({ inventory: { 'orchard-ring': 192 }, equipment: {} });
  const sim = new Simulation(content, 142, content.definitions.initialArea, 1, undefined, owner);
  sim.drops.push({
    id: 'mixed',
    source: 'chest',
    enemy: false,
    x: sim.hero.x,
    z: sim.hero.z,
    rewards: [
      { item: 'gold', amount: 4 },
      { item: 'iron', amount: 1 },
    ],
  });
  const before = owner.snapshot();
  assert.throws(() => sim.collectDrop('mixed'), /pack is full/);
  assert.equal(sim.drops.length, 1);
  assert.deepEqual(owner.snapshot(), before);
});

test('spending across multiple non-stackable entries sums ownership', () => {
  const owner = new InventoryState({ inventory: {}, equipment: {} });
  owner.award([
    { item: 'sword', amount: 2 },
    { item: 'iron', amount: 5 },
  ]);
  assert.equal(owner.inventory.sword, 2);
  assert.equal(owner.pack.filter((entry) => entry.item === 'sword').length, 2);
  // The private spend path must sum across single-quantity gear entries.
  // Before the fix it inspected only the first entry and threw for amount 2.
  const pack = owner.snapshot().pack!.map((entry) => ({ ...entry }));
  (owner as unknown as { spend(pack: PackEntry[], item: string, amount: number): void }).spend(
    pack,
    'sword',
    2,
  );
  assert.equal(pack.filter((entry) => entry.item === 'sword').length, 0);
  // Stackable spending still consumes from its single stack.
  const iron = owner.snapshot().pack!.map((entry) => ({ ...entry }));
  (owner as unknown as { spend(pack: PackEntry[], item: string, amount: number): void }).spend(
    iron,
    'iron',
    3,
  );
  assert.equal(iron.find((entry) => entry.item === 'iron')!.quantity, 2);
  assert.throws(() =>
    (owner as unknown as { spend(pack: PackEntry[], item: string, amount: number): void }).spend(
      pack,
      'sword',
      1,
    ),
  );
});

test('consuming an equipped item is refused instead of reported as a shortage', () => {
  const owner = new InventoryState({
    inventory: { 'orchard-ring': 1, 'health-potion': 1 },
    equipment: { ring1: 'orchard-ring' },
  });
  // The aggregate count includes the equipped copy, which cannot be spent.
  assert.equal(owner.inventory['orchard-ring'], 1);
  assert.equal(owner.consume('orchard-ring'), false);
  assert.equal(owner.equipment.ring1, 'orchard-ring');
  assert.equal(owner.inventory['orchard-ring'], 1);
  // A pack copy of the same item is still spendable.
  owner.award([{ item: 'orchard-ring', amount: 1 }]);
  assert.equal(owner.consume('orchard-ring'), true);
  assert.equal(owner.inventory['orchard-ring'], 1);
  assert.equal(owner.equipment.ring1, 'orchard-ring');
  // Unknown and unowned items never throw either.
  assert.equal(owner.consume('constructor'), false);
  assert.equal(owner.consume('iron'), false);
});
