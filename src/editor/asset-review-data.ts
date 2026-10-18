import { z } from 'zod';

const asset = z
  .string()
  .max(240)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const scene = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/)
  .nullable();
const assetReviewEntrySchema = z.strictObject({
  asset,
  // null retires the asset everywhere; a scene ID requests replacement only there.
  scene,
  notes: z.string().max(2000),
});
export type AssetReviewEntry = z.infer<typeof assetReviewEntrySchema>;
export const assetReviewSchema = z
  .strictObject({
    version: z.literal(1),
    entries: z.array(assetReviewEntrySchema).max(10000),
  })
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    for (const entry of value.entries) {
      const key = reviewKey(entry);
      if (keys.has(key)) ctx.addIssue({ code: 'custom', message: 'Duplicate asset review' });
      keys.add(key);
    }
  });
export type AssetReviews = z.infer<typeof assetReviewSchema>;
export function reviewKey(entry: Pick<AssetReviewEntry, 'asset' | 'scene'>) {
  return JSON.stringify([entry.asset, entry.scene]);
}
