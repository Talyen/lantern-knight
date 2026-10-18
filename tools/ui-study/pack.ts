export const columns = 12;
export const rows = 16;
export type StudyItem = {
  key: string;
  item: string;
  name: string;
  width: number;
  height: number;
  quantity: number;
  x: number;
  y: number;
  effect: string;
};

export function fits(items: readonly StudyItem[], item: StudyItem, x: number, y: number) {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x + item.width <= columns &&
    y + item.height <= rows &&
    !items.some(
      (other) =>
        other.key !== item.key &&
        x < other.x + other.width &&
        x + item.width > other.x &&
        y < other.y + other.height &&
        y + item.height > other.y,
    )
  );
}

export function organize(items: readonly StudyItem[]): StudyItem[] | undefined {
  const packed: StudyItem[] = [];
  for (const item of [...items].sort(
    (a, b) => b.width * b.height - a.width * a.height || a.key.localeCompare(b.key),
  )) {
    let found = false;
    for (let y = 0; y <= rows - item.height && !found; y++)
      for (let x = 0; x <= columns - item.width; x++)
        if (fits(packed, item, x, y)) {
          packed.push({ ...item, x, y });
          found = true;
          break;
        }
    if (!found) return;
  }
  return packed;
}

export function samplePack(state: 'empty' | 'populated' | 'full') {
  if (state === 'empty') return [];
  const definitions = [
    ['sword', 'Oathsteel Sword', 2, 4, 1, 'Physical damage 26'],
    ['leather-armor', 'Leather Armor', 2, 3, 1, 'Body equipment'],
    ['lantern', 'Watch Lantern', 2, 2, 1, 'Burst damage 28 per enemy'],
    ['boots', 'Leather Boots', 2, 2, 1, 'Foot equipment'],
    ['gloves', 'Leather Gloves', 2, 2, 1, 'Hand equipment'],
    ['damaged-axe', 'Damaged Axe', 2, 4, 3, 'Salvage → 6 Iron'],
    ['health-potion', 'Health Potion', 1, 2, 8, 'Restores 40 health'],
    ['iron', 'Iron', 1, 1, 24, 'Forge material'],
    ['bone', 'Bone', 1, 1, 6, 'Salvage material'],
    ['orchard-ring', 'Orchard Ring', 1, 1, 1, 'Maximum health +10'],
    ['orchard-ring', 'Orchard Ring', 1, 1, 1, 'Maximum health +10'],
    ['vigil-amulet', 'Vigil Amulet', 1, 1, 1, 'Maximum health +15'],
    ['belt', 'Leather Belt', 2, 1, 1, 'Belt equipment'],
    ['damaged-helmet', 'Damaged Helmet', 2, 2, 2, 'Salvage → 2 Iron, 2 Bone'],
    ['gatherers-seal', 'Gatherer’s Seal', 1, 1, 1, 'Maximum health +10'],
  ] as const;
  const initial = definitions.map(([item, name, width, height, quantity, effect], index) => ({
    key: `item-${index}`,
    item,
    name,
    width,
    height,
    quantity,
    effect,
    x: 0,
    y: 0,
  }));
  const packed = organize(initial)!;
  if (state === 'full') {
    // Keep the same recognizable loadout, then fill remaining cells with separate
    // jewelry copies. This deliberately makes every cell occupied for comparison.
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const ring = {
          key: `ring-${x}-${y}`,
          item: 'orchard-ring',
          name: 'Orchard Ring',
          width: 1,
          height: 1,
          quantity: 1,
          effect: 'Maximum health +10',
          x,
          y,
        };
        if (fits(packed, ring, x, y)) packed.push(ring);
      }
  }
  return packed;
}
