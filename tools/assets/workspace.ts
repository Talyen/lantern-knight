import path from 'node:path';
import { AssetCache } from './cache';
import { readLock, ensurePack, type AssetLock } from './pack';
import { ensureBundlePack, type AssetScope } from './bundles';
import { prototypeAssets } from './preview';

export type AssetWorkspace = {
  root: string;
  scope: AssetScope;
  publicDirectory: string;
  metadataDirectory: string;
  identity: string;
  recipe: string;
  release: () => Promise<void>;
};
async function acquirePinnedPack(
  lock: AssetLock,
  cache = new AssetCache(),
  scope: AssetScope = 'authoring',
) {
  return lock.schemaVersion === 3
    ? ensureBundlePack(lock, cache, fetch, scope)
    : ensurePack(lock, cache);
}
export async function openWorkspace(
  mode: 'pinned' | 'local' = 'pinned',
  scope: AssetScope = 'runtime',
): Promise<AssetWorkspace> {
  const started = performance.now();
  const cache = new AssetCache();
  const selected = mode === 'local' ? await prototypeAssets(cache, undefined, scope) : undefined;
  const lock = selected?.lock ?? (await readLock());
  const held = selected?.held ?? (await acquirePinnedPack(lock as AssetLock, cache, scope));
  console.log(`Asset workspace (${mode}/${scope}): ${Math.round(performance.now() - started)}ms.`);
  return {
    root: held.root,
    scope,
    publicDirectory: path.join(held.root, 'public'),
    metadataDirectory: path.join(held.root, 'metadata'),
    identity: lock.sha256,
    recipe: lock.recipeSha256,
    release: () => held.release(),
  };
}
// Environment variables are confined to the legacy preparation/test subprocess boundary.
export function workspaceEnvironment(
  workspace: AssetWorkspace,
  env = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    LANTERN_ASSET_WORKSPACE: path.resolve(workspace.root),
    LANTERN_ASSET_SHA256: workspace.identity,
    LANTERN_ASSET_RECIPE_SHA256: workspace.recipe,
    LANTERN_ASSET_ARCHIVE_RECIPE_SHA256: workspace.recipe,
    LANTERN_PREPARING: '0',
  };
}
