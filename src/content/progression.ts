import { items, type Inventory } from './items';

// Recipes belong to the kit, never to a particular scene or interaction object.
export const upgrades = {
  sword: {
    name: 'Temper Sword',
    attribute: 'edge',
    ranks: [{ percent: 200, cost: { gold: 20, iron: 4 } }],
  },
  lantern: {
    name: 'Rekindle Lantern',
    attribute: 'ember',
    ranks: [{ percent: 200, cost: { gold: 20, iron: 4 } }],
  },
} as const;
export type UpgradeId = keyof typeof upgrades;
export type UpgradeRanks = Partial<Record<UpgradeId, number>>;
export const upgradeIds = Object.keys(upgrades) as UpgradeId[];
export function validateUpgrades(ranks: Readonly<UpgradeRanks>) {
  for (const [id, rank] of Object.entries(ranks))
    if (
      !Object.hasOwn(upgrades, id) ||
      !Number.isSafeInteger(rank) ||
      rank < 1 ||
      rank > upgrades[id as UpgradeId].ranks.length
    )
      throw new Error('Unknown upgrade or invalid rank');
}
export function upgradeOffer(
  id: UpgradeId,
  ranks: Readonly<UpgradeRanks>,
  inventory: Readonly<Inventory>,
) {
  if (!Object.hasOwn(upgrades, id)) throw new Error('Unknown upgrade');
  const rank = ranks[id] ?? 0;
  const next = upgrades[id].ranks[rank];
  const reason = !next
    ? 'Maximum rank reached'
    : Object.entries(next.cost).some(([item, amount]) => (inventory[item] ?? 0) < amount)
      ? 'Requires ' +
        Object.entries(next.cost)
          .map(([item, amount]) => `${amount} ${items[item]!.name}`)
          .join(' and ')
      : undefined;
  return { rank, next, reason };
}
export function kitAttributes(ranks: Readonly<UpgradeRanks> = {}) {
  const attributes = { edge: 100, ember: 100 };
  for (const id of upgradeIds) {
    const rank = ranks[id] ?? 0;
    if (rank) attributes[upgrades[id].attribute] = upgrades[id].ranks[rank - 1]!.percent;
  }
  return attributes;
}
export function scaledDamage(base: number, percent: number) {
  return Math.max(1, Math.round((base * percent) / 100));
}
