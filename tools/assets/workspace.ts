import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetCache } from './cache';
import {
  readLock,
  LockSchema,
  ensurePack,
  acceptedRecipe,
  recipeHash,
  validateCachedPack,
} from './pack';
import { checkCurrentAssetPin } from '../check-asset-pin';
import { prototypeAssets } from './preview';

export type AssetMode = 'published' | 'candidate' | 'preview';
export type AssetWorkspace = { env: NodeJS.ProcessEnv; release: () => Promise<void> };
export async function assetWorkspace(
  mode: AssetMode,
  env: NodeJS.ProcessEnv,
): Promise<AssetWorkspace> {
  const cache = new AssetCache();
  if (mode === 'preview') {
    const selected = await prototypeAssets(cache);
    return {
      env: {
        ...env,
        LANTERN_ASSET_WORKSPACE: selected.held.root,
        LANTERN_ASSET_SHA256: selected.lock.sha256,
        LANTERN_ASSET_RECIPE_SHA256: selected.lock.recipeSha256,
        LANTERN_ASSET_ARCHIVE_RECIPE_SHA256: selected.lock.recipeSha256,
        LANTERN_PREPARING: '0',
      },
      release: () => selected.held.release(),
    };
  }
  if (mode === 'published') {
    await checkCurrentAssetPin();
    const lock = await readLock(),
      held = await ensurePack(lock, cache);
    return {
      env: {
        ...env,
        LANTERN_ASSET_WORKSPACE: held.root,
        LANTERN_ASSET_SHA256: lock.sha256,
        LANTERN_ASSET_RECIPE_SHA256: acceptedRecipe(lock),
        LANTERN_ASSET_ARCHIVE_RECIPE_SHA256: lock.recipeSha256,
        LANTERN_PREPARING: '0',
      },
      release: () => held.release(),
    };
  }
  const held = await cache.lease('preparation');
  try {
    const lock = LockSchema.parse(
      JSON.parse(await fs.readFile(path.join(held.root, 'prepared.json'), 'utf8')),
    );
    if (acceptedRecipe(lock) !== (await recipeHash()))
      throw new Error('Candidate preparation is stale; prepare the affected assets.');
    const payload = path.join(held.root, 'work/payload');
    await validateCachedPack(payload, lock);
    return {
      env: {
        ...env,
        LANTERN_ASSET_WORKSPACE: payload,
        LANTERN_ASSET_SHA256: lock.sha256,
        LANTERN_ASSET_RECIPE_SHA256: acceptedRecipe(lock),
        LANTERN_ASSET_ARCHIVE_RECIPE_SHA256: lock.recipeSha256,
        LANTERN_PREPARING: '0',
      },
      release: () => held.release(),
    };
  } catch (error) {
    await held.release();
    throw error;
  }
}
