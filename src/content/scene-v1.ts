import baseline from './scene-v1-baseline.json';
import { applySceneryPreset, localOffset } from './scenery-presets';
// Frozen, bounded authoring compatibility only. Version 2 never uses this baseline.
export function migrateSceneV1(d: {
  base: string;
  changes: { id: string; deleted?: boolean; [key: string]: unknown }[];
  objects: { id: string; asset: string; clip: string; [key: string]: unknown }[];
  [key: string]: unknown;
}) {
  const original = baseline[d.base as keyof typeof baseline];
  const objects: Record<string, unknown>[] = structuredClone(original?.objects ?? []);
  for (const c of d.changes) {
    if (!original?.editableIds.includes(c.id))
      throw new Error('Locked or unavailable object: ' + c.id);
    const index = objects.findIndex((p) => p.id === c.id);
    if (objects[index]?.kind === 'prop' && c.rotation !== undefined)
      throw new Error('Upright artwork has a fixed authored facing');
    const { id, deleted, ...fields } = c;
    if (deleted) objects.splice(index, 1);
    else Object.assign(objects[index]!, fields);
  }
  // Former mount offsets were world distances at the original support scale.
  for (const p of objects) {
    const mount = p.mount as { to: string; offset: number[] } | undefined;
    if (mount) {
      const support = original?.objects.find((p) => p.id === mount.to);
      if (!support) throw new Error('Missing legacy attachment support: ' + mount.to);
      mount.offset = localOffset(support, mount.offset);
    }
  }
  const ids = new Set(objects.map((p) => p.id));
  for (const p of d.objects) {
    if (ids.has(p.id)) throw new Error('Object identity already exists: ' + p.id);
    ids.add(p.id);
    objects.push(
      applySceneryPreset({ ...p, purpose: 'Scene editor scenery', shadow: p.shadow ?? 'none' }),
    );
  }
  const { changes: _, ...fields } = d;
  return { ...fields, version: 2, objects };
}
