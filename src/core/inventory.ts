import {
  items,
  equipmentSlots,
  healthBonus,
  type Inventory,
  type Equipment,
  type EquipmentSlot,
  type Reward,
} from '../content/items';
import {
  upgradeOffer,
  validateUpgrades,
  type UpgradeId,
  type UpgradeRanks,
} from '../content/progression';
import { packFits, placeEntry, organizePack, type PackEntry } from './pack';
export const MAX_ITEM_COUNT = 100000000;
export type InventorySnapshot = {
  inventory: Inventory;
  equipment: Equipment;
  pack?: PackEntry[];
  upgrades?: UpgradeRanks;
};
export type InventoryCommand =
  | { kind: 'equip'; item: string; slot: EquipmentSlot; entry?: string }
  | { kind: 'unequip'; slot: EquipmentSlot }
  | { kind: 'salvage'; item?: string }
  | { kind: 'move'; entry: string; x: number; y: number }
  | { kind: 'organize' };

export function validateInventory({ inventory, equipment, upgrades, pack }: InventorySnapshot) {
  validateUpgrades(upgrades ?? {});
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
      !items[item]!.slots?.includes(slot as EquipmentSlot)
    )
      throw new Error('Incompatible equipment');
    used[item] = (used[item] ?? 0) + 1;
    if (used[item]! > (inventory[item] ?? 0)) throw new Error('Equipment not owned');
  }
  if (pack) {
    if (pack.length > 192) throw new Error('Invalid pack size');
    const keys = new Set<string>(),
      stacks = new Set<string>();
    for (const entry of pack) {
      if (
        !/^entry-[0-9]+$/.test(entry.key) ||
        !Number.isSafeInteger(Number(entry.key.slice(6))) ||
        Number(entry.key.slice(6)) < 1 ||
        keys.has(entry.key) ||
        !Object.hasOwn(items, entry.item) ||
        entry.item === 'gold' ||
        !Number.isSafeInteger(entry.quantity) ||
        entry.quantity < 1 ||
        entry.quantity > MAX_ITEM_COUNT ||
        (!items[entry.item]!.stackable && entry.quantity !== 1)
      )
        throw new Error('Invalid pack entry');
      keys.add(entry.key);
      if (items[entry.item]!.stackable) {
        if (stacks.has(entry.item)) throw new Error('Duplicate supply stack');
        stacks.add(entry.item);
      }
      if (!packFits(pack, entry, entry.x, entry.y)) throw new Error('Invalid pack placement');
      used[entry.item] = (used[entry.item] ?? 0) + entry.quantity;
    }
    for (const [item, amount] of Object.entries(inventory))
      if (item !== 'gold' && (used[item] ?? 0) !== amount)
        throw new Error('Pack ownership differs');
    for (const [item, amount] of Object.entries(used))
      if ((inventory[item] ?? 0) !== amount) throw new Error('Pack ownership differs');
  }
}
export interface InventoryAccess {
  readonly inventory: Readonly<Inventory>;
  readonly equipment: Readonly<Equipment>;
  readonly healthBonus: number;
  readonly upgrades: Readonly<UpgradeRanks>;
  award(rewards: readonly Reward[]): void;
  consume(item: string): boolean;
}
// Entries, equipped items and the wallet are canonical. Aggregate counts are a
// frozen compatibility view for combat/progression, never a second mutable owner.
export class InventoryState implements InventoryAccess {
  private state: {
    pack: readonly Readonly<PackEntry>[];
    equipment: Readonly<Equipment>;
    inventory: Readonly<Inventory>;
    healthBonus: number;
    upgrades: Readonly<UpgradeRanks>;
  };
  constructor(snapshot: InventorySnapshot = { inventory: {}, equipment: {} }) {
    validateInventory(snapshot);
    const pack = snapshot.pack?.map((entry) => ({ ...entry })) ?? [];
    if (!snapshot.pack)
      for (const [item, count] of Object.entries(snapshot.inventory)) {
        if (item === 'gold') continue;
        const spare = count - Object.values(snapshot.equipment).filter((id) => id === item).length;
        if (spare <= 0) continue;
        if (!items[item]!.stackable && spare > 192) throw new Error('Your pack is full');
        if (items[item]!.stackable) this.add(pack, item, spare);
        else for (let index = 0; index < spare; index++) this.add(pack, item, 1);
      }
    this.state = this.accept(
      pack,
      snapshot.equipment,
      snapshot.inventory.gold ?? 0,
      snapshot.upgrades,
      snapshot.inventory,
    );
  }
  private add(pack: PackEntry[], item: string, amount: number) {
    const stack = items[item]!.stackable && pack.find((entry) => entry.item === item);
    if (stack) {
      stack.quantity += amount;
      return;
    }
    // At most 192 entries exist; searching free keys also tolerates a valid
    // restored key near MAX_SAFE_INTEGER without overflowing its successor.
    const used = new Set(pack.map((entry) => entry.key));
    let next = 1;
    while (used.has(`entry-${next}`)) next++;
    const key = `entry-${next}`;
    placeEntry(pack, { key, item, quantity: amount, x: 0, y: 0 });
  }
  private accept(
    pack: PackEntry[],
    equipment: Equipment,
    gold: number,
    upgrades?: UpgradeRanks,
    known: Readonly<Inventory> = this.state?.inventory ?? {},
  ) {
    const inventory: Inventory = Object.fromEntries(Object.keys(known).map((id) => [id, 0]));
    if (gold || Object.hasOwn(known, 'gold')) inventory.gold = gold;
    for (const item of Object.values(equipment)) inventory[item] = (inventory[item] ?? 0) + 1;
    for (const entry of pack) inventory[entry.item] = (inventory[entry.item] ?? 0) + entry.quantity;
    validateInventory({ inventory, equipment, pack, upgrades });
    return Object.freeze({
      pack: Object.freeze(pack.map((entry) => Object.freeze({ ...entry }))),
      equipment: Object.freeze({ ...equipment }),
      inventory: Object.freeze(inventory),
      healthBonus: healthBonus(equipment),
      upgrades: Object.freeze({ ...upgrades }),
    });
  }
  get inventory() {
    return this.state.inventory;
  }
  get equipment() {
    return this.state.equipment;
  }
  get pack() {
    return this.state.pack;
  }
  get upgrades() {
    return this.state.upgrades;
  }
  get healthBonus() {
    return this.state.healthBonus;
  }
  snapshot(): InventorySnapshot {
    return {
      inventory: { ...this.inventory },
      equipment: { ...this.equipment },
      pack: this.pack.map((entry) => ({ ...entry })),
      upgrades: { ...this.upgrades },
    };
  }
  private draft() {
    return {
      pack: this.pack.map((entry) => ({ ...entry })),
      equipment: { ...this.equipment },
      gold: this.inventory.gold ?? 0,
      upgrades: this.upgrades,
    };
  }
  private spend(pack: PackEntry[], item: string, amount: number) {
    const entry = pack.find((entry) => entry.item === item);
    if (!entry || entry.quantity < amount) throw new Error('Not enough inventory items');
    entry.quantity -= amount;
    if (!entry.quantity) pack.splice(pack.indexOf(entry), 1);
  }
  prepareUpgradePurchase(choice: UpgradeId) {
    const { next, reason } = upgradeOffer(choice, this.upgrades, this.inventory);
    if (!next || reason) throw new Error(reason);
    const previous = this.state,
      draft = this.draft();
    for (const [item, amount] of Object.entries(next.cost)) {
      if ((this.inventory[item] ?? 0) < amount) throw new Error('Insufficient upgrade materials');
      if (item === 'gold') draft.gold -= amount;
      else this.spend(draft.pack, item, amount);
    }
    const accepted = this.accept(draft.pack, draft.equipment, draft.gold, {
      ...this.upgrades,
      [choice]: (this.upgrades[choice] ?? 0) + 1,
    });
    return {
      snapshot: {
        inventory: { ...accepted.inventory },
        equipment: { ...accepted.equipment },
        pack: accepted.pack.map((entry) => ({ ...entry })),
        upgrades: { ...accepted.upgrades },
      },
      commit: () => {
        if (this.state !== previous) throw new Error('Stale upgrade purchase');
        this.state = accepted;
      },
    };
  }
  award(rewards: readonly Reward[]) {
    if (!rewards.length) return;
    const draft = this.draft();
    for (const { item, amount } of rewards) {
      if (
        !Object.hasOwn(items, item) ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount > MAX_ITEM_COUNT ||
        (this.inventory[item] ?? 0) + amount > MAX_ITEM_COUNT
      )
        throw new Error('Invalid inventory reward');
      if (item === 'gold') draft.gold += amount;
      else if (items[item]!.stackable) this.add(draft.pack, item, amount);
      else {
        if (amount > 192) throw new Error('Your pack is full');
        for (let index = 0; index < amount; index++) this.add(draft.pack, item, 1);
      }
    }
    this.state = this.accept(draft.pack, draft.equipment, draft.gold, draft.upgrades);
  }
  consume(item: string) {
    if (!Object.hasOwn(items, item) || !(this.inventory[item] ?? 0)) return false;
    const draft = this.draft();
    if (item === 'gold') draft.gold--;
    else this.spend(draft.pack, item, 1);
    this.state = this.accept(draft.pack, draft.equipment, draft.gold, draft.upgrades);
    return true;
  }
  change(command: InventoryCommand): boolean {
    const draft = this.draft();
    if (command.kind === 'move') {
      const entry = draft.pack.find((entry) => entry.key === command.entry);
      if (!entry) throw new Error('Item no longer in your pack');
      if (!packFits(draft.pack, entry, command.x, command.y))
        throw new Error('That space is blocked. Your item has not moved.');
      if (entry.x === command.x && entry.y === command.y) return false;
      entry.x = command.x;
      entry.y = command.y;
    } else if (command.kind === 'organize') {
      try {
        draft.pack = organizePack(draft.pack);
      } catch {
        throw new Error('Could not organize this pack. Move an item to make room.');
      }
      if (
        draft.pack.every((entry) =>
          this.pack.some((old) => old.key === entry.key && old.x === entry.x && old.y === entry.y),
        )
      )
        return false;
    } else if (command.kind === 'equip') {
      if (
        !Object.hasOwn(items, command.item) ||
        !items[command.item]!.slots?.includes(command.slot)
      )
        throw new Error('Incompatible equipment');
      if (draft.equipment[command.slot] === command.item) return false;
      const entry = draft.pack.find(
        (entry) => entry.item === command.item && (!command.entry || entry.key === command.entry),
      );
      if (!entry) throw new Error('Equipment not owned');
      draft.pack.splice(draft.pack.indexOf(entry), 1);
      const replaced = draft.equipment[command.slot];
      if (replaced) this.add(draft.pack, replaced, 1);
      draft.equipment[command.slot] = command.item;
    } else if (command.kind === 'unequip') {
      if (!equipmentSlots.includes(command.slot)) throw new Error('Incompatible equipment');
      const item = draft.equipment[command.slot];
      if (!item) return false;
      this.add(draft.pack, item, 1);
      delete draft.equipment[command.slot];
    } else {
      const salvaged = draft.pack.filter(
        (entry) => (!command.item || entry.item === command.item) && items[entry.item]!.salvage,
      );
      if (!salvaged.length) return false;
      draft.pack = draft.pack.filter((entry) => !salvaged.includes(entry));
      for (const entry of salvaged)
        for (const [material, amount] of Object.entries(items[entry.item]!.salvage!))
          this.add(draft.pack, material, amount * entry.quantity);
    }
    this.state = this.accept(draft.pack, draft.equipment, draft.gold, draft.upgrades);
    return true;
  }
}
