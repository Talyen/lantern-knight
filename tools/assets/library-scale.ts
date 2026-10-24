import { createHash } from 'node:crypto';
import { z } from 'zod';
import packs from '../../assets/library-packs.json';
import { ActorScaleSchema, actorFrameScales } from './actor-scale';

export type NativeDrawing = {
  group: string;
  member: string;
  indexPath?: string;
  sourceSha256?: string;
  canvas: [number, number];
  anchor: [number, number];
  density: number;
  rect?: [number, number, number, number];
  trim?: [number, number, number, number];
  visualOffsetPx?: [number, number];
};
export type ScaleAsset = {
  id: string;
  label: string;
  type: string;
  clips: Record<
    string,
    Partial<
      Record<
        string,
        {
          frames: NativeDrawing[];
          durationsMs: number[];
          loop: boolean;
          endBehavior: 'hide' | 'hold';
        }
      >
    >
  >;
};
export const LibraryScaleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  assets: z.record(
    z.string(),
    ActorScaleSchema.extend({
      sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export type LibraryScaleRecipe = z.infer<typeof LibraryScaleSchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Use the native pixel identity and registration, never the generated frame ID:
// a compiled ID includes the correction itself. Paths may move without changing art.
export function nativeDrawingKey(frame: NativeDrawing) {
  if (!frame.sourceSha256 || !/^[a-f0-9]{64}$/.test(frame.sourceSha256))
    throw new Error('Scale review requires a verified source drawing: ' + frame.member);
  return (
    'drawing-' +
    digest([
      frame.sourceSha256,
      frame.canvas,
      frame.anchor,
      frame.density,
      frame.rect ?? null,
      frame.trim ?? null,
      frame.visualOffsetPx ?? null,
    ]).slice(0, 24)
  );
}
export function scaleClips(asset: ScaleAsset) {
  return Object.entries(asset.clips).flatMap(([id, directions]) =>
    Object.entries(directions).map(([heading, clip]) => {
      if (!clip) throw new Error('Missing scale review clip');
      return { id, heading, frames: clip.frames.map(nativeDrawingKey) };
    }),
  );
}
export function scaleSourceIdentity(asset: ScaleAsset) {
  return digest(
    scaleClips(asset).sort((a, b) => {
      const left = `${a.id}:${a.heading}`,
        right = `${b.id}:${b.heading}`;
      return left < right ? -1 : left > right ? 1 : 0;
    }),
  );
}
const enemyGroups = new Set(packs.packs.filter((pack) => pack.category === 2).map((p) => p.group));
export function enemyScaleAssets(assets: readonly ScaleAsset[]) {
  return assets.filter(
    (asset) =>
      asset.type === 'character' &&
      Object.values(asset.clips).some((directions) =>
        Object.values(directions).some((clip) =>
          clip?.frames.some((frame) => enemyGroups.has(frame.group)),
        ),
      ),
  );
}
export function libraryFrameScales(asset: ScaleAsset, recipe: LibraryScaleRecipe) {
  if (!Object.hasOwn(recipe.assets, asset.id)) return undefined;
  const review = recipe.assets[asset.id]!;
  if (asset.type !== 'character') throw new Error('Scale review requires a character: ' + asset.id);
  if (review.sourceSha256 !== scaleSourceIdentity(asset))
    throw new Error(
      'Actor scale review is stale; review changed drawings/registration: ' + asset.id,
    );
  const { baseline, notes, clips, frames } = review;
  return actorFrameScales({ baseline, notes, clips, frames }, scaleClips(asset));
}
export function validateScaleCoverage(
  assets: readonly ScaleAsset[],
  value: unknown,
  activeAssets?: ReadonlySet<string>,
) {
  const recipe = LibraryScaleSchema.parse(value);
  const required = enemyScaleAssets(assets);
  for (const asset of required)
    if (!Object.hasOwn(recipe.assets, asset.id))
      throw new Error('Enemy animation needs scale review: ' + asset.id);
  for (const id of Object.keys(recipe.assets)) {
    if (activeAssets && !activeAssets.has(id)) continue;
    const asset = assets.find((asset) => asset.id === id);
    if (!asset) throw new Error('Unknown actor scale asset: ' + id);
    libraryFrameScales(asset, recipe);
  }
  return recipe;
}
