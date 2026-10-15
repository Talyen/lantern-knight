import {
  items,
  equipmentSlots,
  healthBonus,
  type Inventory,
  type Equipment,
  type EquipmentSlot,
  type Reward,
} from '../content/items';

import { forgeCost, type ForgeUpgrade } from '../content/progression';

export const MAX_ITEM_COUNT = 100000000;
export type InventorySnapshot = {
  inventory: Inventory;
  equipment: Equipment;
  forgeUpgrade?: ForgeUpgrade;
};

// Save admission and live commands enforce the same ownership/count contract.
export function validateInventory({ inventory, equipment, forgeUpgrade }: InventorySnapshot) {
  if (forgeUpgrade !== undefined && forgeUpgrade !== 'sword' && forgeUpgrade !== 'lantern')
    throw new Error('Unknown forge upgrade');
  if ((inventory['workshop-temper'] ?? 0) > (forgeUpgrade ? 0 : 1))
    throw new Error('Invalid workshop temper ownership');
  for (const [item, amount] of Object.entries(inventory))
    if (
      !Object.hasOwn(items, item) ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > MAX_ITEM_COUNT
    )
      throw new Error('Invalid inventory item or amount');
  const used: Record<string, number> = {};
  for (const [slot, item] of Object.entries(equipment)) {
    if (
      !equipmentSlots.includes(slot as EquipmentSlot) ||
      !Object.hasOwn(items, item) ||
      !items[item]?.slots?.includes(slot as EquipmentSlot)
    )
      throw new Error('Incompatible equipment');
    used[item] = (used[item] ?? 0) + 1;
    if (used[item]! > (inventory[item] ?? 0)) throw new Error('Equipment not owned');
  }
}

// Simulation receives only loot/consumption capabilities, never equipment writes.
export interface InventoryAccess {
  readonly inventory: Readonly<Inventory>;
  readonly equipment: Readonly<Equipment>;
  readonly healthBonus: number;
  readonly forgeUpgrade?: ForgeUpgrade;
  award(rewards: readonly Reward[]): void;
  consume(item: string): boolean;
}

export class InventoryState implements InventoryAccess {
  private state: InventorySnapshot;
  constructor(snapshot: InventorySnapshot = { inventory: {}, equipment: {} }) {
    this.state = this.accept(snapshot);
  }
  private accept(snapshot: InventorySnapshot): InventorySnapshot {
    const next = structuredClone({
      inventory: snapshot.inventory,
      equipment: snapshot.equipment,
      ...(snapshot.forgeUpgrade !== undefined ? { forgeUpgrade: snapshot.forgeUpgrade } : {}),
    });
    validateInventory(next);
    Object.freeze(next.inventory);
    Object.freeze(next.equipment);
    return Object.freeze(next);
  }
  get inventory(): Readonly<Inventory> {
    return this.state.inventory;
  }
  get equipment(): Readonly<Equipment> {
    return this.state.equipment;
  }
  get forgeUpgrade() {
    return this.state.forgeUpgrade;
  }
  prepareForgePurchase(choice: ForgeUpgrade) {
    if (choice !== 'sword' && choice !== 'lantern') throw new Error('Unknown forge upgrade');
    if (this.forgeUpgrade) throw new Error('Your workshop temper has already been used');
    const previous = this.state;
    const draft = this.snapshot();
    for (const [item, amount] of Object.entries(forgeCost)) {
      if ((draft.inventory[item] ?? 0) < amount)
        throw new Error('Requires 20 Gold, 4 Iron and 1 Workshop Temper');
      draft.inventory[item]! -= amount;
    }
    draft.forgeUpgrade = choice;
    const accepted = this.accept(draft);
    return {
      snapshot: structuredClone(accepted),
      commit: () => {
        if (this.state !== previous) throw new Error('Stale forge purchase');
        this.state = accepted;
      },
    };
  }
  get healthBonus() {
    return healthBonus(this.equipment);
  }
  snapshot(): InventorySnapshot {
    return structuredClone(this.state);
  }
  private update(change: (draft: InventorySnapshot) => void) {
    const next = this.snapshot();
    change(next);
    this.state = this.accept(next);
  }
  award(rewards: readonly Reward[]) {
    this.update(({ inventory }) => {
      for (const { item, amount } of rewards) {
        if (!Object.hasOwn(items, item) || !Number.isSafeInteger(amount) || amount <= 0)
          throw new Error('Invalid reward');
        inventory[item] = (inventory[item] ?? 0) + amount;
      }
    });
  }
  consume(item: string) {
    if (!Object.hasOwn(items, item) || (this.inventory[item] ?? 0) <= 0) return false;
    this.update(({ inventory }) => {
      inventory[item]!--;
    });
    return true;
  }
  equip(item: string, slot: EquipmentSlot) {
    this.update(({ equipment }) => {
      equipment[slot] = item;
    });
  }
  unequip(slot: EquipmentSlot) {
    this.update(({ equipment }) => {
      delete equipment[slot];
    });
  }
  salvage(item?: string) {
    this.update(({ inventory, equipment }) => {
      for (const [id, count] of Object.entries(inventory)) {
        if (item && item !== id) continue;
        const yields = items[id]?.salvage;
        if (!yields || !count) continue;
        if (Object.values(equipment).includes(id)) throw new Error('Unequip before salvaging');
        for (const [material, amount] of Object.entries(yields))
          inventory[material] = (inventory[material] ?? 0) + count * amount;
        inventory[id] = 0;
      }
    });
  }
}
