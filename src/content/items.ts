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
  footprint: readonly [number, number];
  stackable: boolean;
  kind: 'currency' | 'material' | 'potion' | 'salvage' | 'gear';
  slots?: readonly EquipmentSlot[];
  maxHealth?: number;
  burningSwordBonusPercent?: number;
  salvage?: Readonly<Record<string, number>>;
};
export const items: Readonly<Record<string, ItemDefinition>> = {
  gold: { footprint: [1, 1], stackable: true, name: 'Gold', kind: 'currency' },
  iron: { footprint: [1, 1], stackable: true, name: 'Iron', kind: 'material' },
  bone: { footprint: [1, 1], stackable: true, name: 'Bone', kind: 'material' },
  'health-potion': { footprint: [1, 2], stackable: true, name: 'Health Potion', kind: 'potion' },
  'damaged-axe': {
    footprint: [2, 4],
    stackable: true,
    name: 'Damaged Axe',
    kind: 'salvage',
    salvage: { iron: 2 },
  },
  'damaged-helmet': {
    footprint: [2, 2],
    stackable: true,
    name: 'Damaged Helmet',
    kind: 'salvage',
    salvage: { iron: 1, bone: 1 },
  },
  'travellers-charm': {
    footprint: [1, 1],
    stackable: false,
    name: 'Traveller’s Charm',
    kind: 'gear',
    slots: ['trinket'],
    maxHealth: 5,
  },
  'gatherers-seal': {
    footprint: [1, 1],
    stackable: false,
    name: 'Gatherer’s Seal',
    kind: 'gear',
    slots: ['trinket'],
    maxHealth: 10,
  },
  'orchard-ring': {
    footprint: [1, 1],
    stackable: false,
    name: 'Orchard Ring',
    kind: 'gear',
    slots: ['ring1', 'ring2'],
    maxHealth: 10,
  },
  'cinder-signet': {
    footprint: [1, 1],
    stackable: false,
    name: 'Cinder Signet',
    kind: 'gear',
    slots: ['ring1', 'ring2'],
    burningSwordBonusPercent: 25,
  },
  'vigil-amulet': {
    footprint: [1, 1],
    stackable: false,
    name: 'Vigil Amulet',
    kind: 'gear',
    slots: ['amulet'],
    maxHealth: 15,
  },
  'cloth-armor': {
    footprint: [2, 3],
    stackable: false,
    name: 'Cloth Armor',
    kind: 'gear',
    slots: ['body'],
  },
  'leather-armor': {
    footprint: [2, 3],
    stackable: false,
    name: 'Leather Armor',
    kind: 'gear',
    slots: ['body'],
  },
  gloves: {
    footprint: [2, 2],
    stackable: false,
    name: 'Leather Gloves',
    kind: 'gear',
    slots: ['gloves'],
  },
  belt: {
    footprint: [2, 1],
    stackable: false,
    name: 'Leather Belt',
    kind: 'gear',
    slots: ['belt'],
  },
  boots: {
    footprint: [2, 2],
    stackable: false,
    name: 'Leather Boots',
    kind: 'gear',
    slots: ['boots'],
  },
  amulet: { footprint: [1, 1], stackable: false, name: 'Amulet', kind: 'gear', slots: ['amulet'] },
  trinket: {
    footprint: [1, 1],
    stackable: false,
    name: 'Trinket',
    kind: 'gear',
    slots: ['trinket'],
  },
  sword: { footprint: [2, 4], stackable: false, name: 'Sword', kind: 'gear', slots: ['sword'] },
  lantern: {
    footprint: [2, 2],
    stackable: false,
    name: 'Lantern',
    kind: 'gear',
    slots: ['lantern'],
  },
};
export type Inventory = Record<string, number>;
export type Equipment = Partial<Record<EquipmentSlot, string>>;
export type Reward = { item: string; amount: number };
export function healthBonus(equipment: Readonly<Equipment>) {
  return Object.values(equipment).reduce((sum, id) => sum + (items[id]?.maxHealth ?? 0), 0);
}

// Duplicate equipped copies grant the strongest authored bonus once.
export function burningSwordBonus(equipment: Readonly<Equipment>) {
  return Math.max(
    0,
    ...Object.values(equipment).map((id) => items[id]?.burningSwordBonusPercent ?? 0),
  );
}
