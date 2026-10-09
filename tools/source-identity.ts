import fs from 'node:fs/promises';
import path from 'node:path';
import { authoredIdentity } from './authored-inputs';
import { createHash } from 'node:crypto';
import { LockSchema, acceptedRecipe } from './assets/pack';

export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, item]) => [k, canonical(item)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export async function sourceIdentity(root: string) {
  const source = await authoredIdentity(root, { scope: 'runtime' });
  const lock = LockSchema.parse(
    JSON.parse(await fs.readFile(path.join(root, 'assets/lock.json'), 'utf8')),
  );
  return {
    ...source,
    identityVersion: 4 as const,
    assetSha256: lock.sha256,
    archiveRecipeSha256: lock.recipeSha256,
    preparationRecipeSha256: acceptedRecipe(lock),
  };
}
