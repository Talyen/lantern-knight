export const equipmentSlots = [
  'body',
  'gloves',
  'belt',
  'boots',
  'ring1',
  'ring2',
  'amulet',
  'trinket',
  'sword',
  'lantern',
] as const;
export type EquipmentSlot = (typeof equipmentSlots)[number];
export type ItemDefinition = {
  name: string;
  kind: 'currency' | 'material' | 'potion' | 'salvage' | 'gear';
  slots?: readonly EquipmentSlot[];
  maxHealth?: number;
  salvage?: Readonly<Record<string, number>>;
};
export const items: Readonly<Record<string, ItemDefinition>> = {
  gold: { name: 'Gold', kind: 'currency' },
  iron: { name: 'Iron', kind: 'material' },
  bone: { name: 'Bone', kind: 'material' },
  'health-potion': { name: 'Health Potion', kind: 'potion' },
  'damaged-axe': { name: 'Damaged Axe', kind: 'salvage', salvage: { iron: 2 } },
  'damaged-helmet': { name: 'Damaged Helmet', kind: 'salvage', salvage: { iron: 1, bone: 1 } },
  'travellers-charm': {
    name: 'Traveller’s Charm',
    kind: 'gear',
    slots: ['trinket'],
    maxHealth: 5,
  },
  'gatherers-seal': {
    name: 'Gatherer’s Seal',
    kind: 'gear',
    slots: ['trinket'],
    maxHealth: 10,
  },
  'orchard-ring': { name: 'Orchard Ring', kind: 'gear', slots: ['ring1', 'ring2'], maxHealth: 10 },
  'cloth-armor': { name: 'Cloth Armor', kind: 'gear', slots: ['body'] },
  'leather-armor': { name: 'Leather Armor', kind: 'gear', slots: ['body'] },
  gloves: { name: 'Leather Gloves', kind: 'gear', slots: ['gloves'] },
  belt: { name: 'Leather Belt', kind: 'gear', slots: ['belt'] },
  boots: { name: 'Leather Boots', kind: 'gear', slots: ['boots'] },
  amulet: { name: 'Amulet', kind: 'gear', slots: ['amulet'] },
  trinket: { name: 'Trinket', kind: 'gear', slots: ['trinket'] },
  sword: { name: 'Sword', kind: 'gear', slots: ['sword'] },
  lantern: { name: 'Lantern', kind: 'gear', slots: ['lantern'] },
};
export type Inventory = Record<string, number>;
export type Equipment = Partial<Record<EquipmentSlot, string>>;
export type Reward = { item: string; amount: number };
export function healthBonus(equipment: Readonly<Equipment>) {
  return Object.values(equipment).reduce((sum, id) => sum + (items[id]?.maxHealth ?? 0), 0);
}
