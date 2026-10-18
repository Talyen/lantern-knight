import { items } from '../content/items';
export const packColumns = 12;
export const packRows = 16;
export type PackEntry = { key: string; item: string; quantity: number; x: number; y: number };

export function packFits(pack: readonly PackEntry[], entry: PackEntry, x: number, y: number) {
  const [width, height] = items[entry.item]!.footprint;
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x + width <= packColumns &&
    y + height <= packRows &&
    !pack.some((other) => {
      if (other.key === entry.key) return false;
      const [w, h] = items[other.item]!.footprint;
      return x < other.x + w && x + width > other.x && y < other.y + h && y + height > other.y;
    })
  );
}

export function placeEntry(pack: PackEntry[], entry: PackEntry) {
  const [width, height] = items[entry.item]!.footprint;
  for (let y = 0; y <= packRows - height; y++)
    for (let x = 0; x <= packColumns - width; x++) {
      if (packFits(pack, entry, x, y)) {
        pack.push({ ...entry, x, y });
        return;
      }
    }
  throw new Error('Your pack is full. Move items, equip gear, or salvage equipment to make room.');
}

export function organizePack(pack: readonly PackEntry[]) {
  const result: PackEntry[] = [];
  for (const entry of [...pack].sort((a, b) => {
    const [aw, ah] = items[a.item]!.footprint,
      [bw, bh] = items[b.item]!.footprint;
    return bw * bh - aw * ah || a.item.localeCompare(b.item) || a.key.localeCompare(b.key);
  }))
    placeEntry(result, entry);
  return result;
}
