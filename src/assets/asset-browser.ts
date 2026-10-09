import { z } from 'zod';
import type { Manifest } from './schema';
import type { AssetRuntime } from './loader';
export type AssetScope = 'all' | 'used' | 'scene';
export const assetFilterSchema = z.object({
  scope: z.enum(['all', 'used', 'scene']),
  animated: z.boolean(),
  type: z.enum(['all', 'character', 'prop', 'decal', 'material', 'effect', 'pickup', 'reference']),
  search: z.string(),
});
export type AssetFilter = z.infer<typeof assetFilterSchema>;
export function animatedSequence(clip: { frames: string[] }) {
  return new Set(clip.frames).size > 1;
}
export function animatedAsset(manifest: Manifest) {
  return Object.values(manifest.asset.clips).some((directions) =>
    Object.values(directions).some((clip) => clip && animatedSequence(clip)),
  );
}
export function assetLabel(manifest: Manifest) {
  return (manifest.asset.label ?? manifest.asset.id.replace(/^(ink|library|fx)-/, ''))
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
}
export function assetClosure(roots: Iterable<string>, manifests: ReadonlyMap<string, Manifest>) {
  const ids = new Set(roots);
  for (const id of ids)
    for (const dependency of manifests.get(id)?.asset.dependencies ?? []) ids.add(dependency);
  return ids;
}
export function matchesAsset(
  manifest: Manifest,
  filter: AssetFilter,
  used: ReadonlySet<string>,
  scene: ReadonlySet<string>,
) {
  const asset = manifest.asset;
  const type = filter.type;
  const typeMatches =
    type === 'all' ||
    type === asset.type ||
    type === asset.category ||
    (type === 'prop' && asset.type === 'prop' && asset.placement !== 'ground') ||
    (type === 'decal' && asset.placement === 'ground');
  return (
    typeMatches &&
    (!filter.animated || animatedAsset(manifest)) &&
    (filter.scope === 'all' || (filter.scope === 'used' ? used : scene).has(asset.id)) &&
    `${assetLabel(manifest)} ${asset.id} ${Object.keys(asset.clips).join(' ')}`
      .toLowerCase()
      .includes(filter.search.toLowerCase())
  );
}
export function assetFilterHTML(typeId: string) {
  return `<label>Usage<select id="asset-scope" aria-label="Asset usage"><option value="all">All assets</option><option value="used">In use</option><option value="scene">In this scene</option></select></label>
    <label>Type<select id="${typeId}" aria-label="Asset type"><option value="all">All types</option><option value="character">Characters</option><option value="prop">Scenery</option><option value="decal">Ground details</option><option value="material">Materials</option><option value="effect">Effects</option><option value="pickup">Pickups</option><option value="reference">References</option></select></label>
    <label class="check"><input id="asset-animated" type="checkbox">Animated</label>`;
}
export async function loadAssetIndex(runtime: AssetRuntime, signal: AbortSignal) {
  const ids = Object.keys(runtime.catalog),
    manifests = new Map<string, Manifest>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, ids.length) }, async () => {
      while (next < ids.length) {
        signal.throwIfAborted();
        const id = ids[next++]!;
        const manifest = await runtime.manifest(id);
        signal.throwIfAborted();
        manifests.set(id, manifest);
      }
    }),
  );
  return manifests;
}
