import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryState, MAX_ITEM_COUNT } from '../../src/core/inventory';

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
