import { readJson } from '../json-file';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { AssetCache } from './cache';
import { projectRoot } from './paths';
import { readLock, type AssetLock } from './pack';
import { acquirePinnedPack } from './pinned';
import { type AssetScope } from './bundles';
import { openDemandWorkspace } from './demand';
import { prototypeAssets } from './preview';

export type AssetWorkspace = {
  root: string;
  scope: AssetScope;
  publicDirectory: string;
  metadataDirectory: string;
  identity: string;
  recipe: string;
  ensurePublicFile?: (relative: string) => Promise<boolean>;
  release: () => Promise<void>;
};
export async function openWorkspace(
  mode: 'pinned' | 'local' = 'pinned',
  scope: AssetScope = 'runtime',
  demand = false,
): Promise<AssetWorkspace> {
  const started = performance.now();
  const cache = new AssetCache();
  const fallback =
    demand && scope === 'authoring'
      ? async (lock: AssetLock) =>
          lock.schemaVersion === 3 || lock.schemaVersion === 4
            ? openDemandWorkspace(lock, cache)
            : undefined
      : undefined;
  if (mode === 'pinned' && fallback) {
    const workspace = await fallback(await readLock());
    if (workspace) return workspace;
  }
  const selected =
    mode === 'local'
      ? await prototypeAssets(cache, undefined, scope, false, fallback, demand)
      : undefined;
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
    ensurePublicFile: 'ensurePublicFile' in held ? held.ensurePublicFile : undefined,
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

// Server reuse reads identity metadata only; it acquires no payload or lease.
export async function workspaceIdentity(mode: 'pinned' | 'local') {
  if (mode === 'local') {
    const cache = new AssetCache();
    const prefix =
      'preview-' +
      createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 20);
    try {
      const pointer = await readJson(
        path.join(cache.root, 'entries', prefix + '-index', 'preview.json'),
      );
      if (
        typeof pointer.entry !== 'string' ||
        !/^preview-[a-f0-9]{20}-[a-f0-9]{24}$/.test(pointer.entry)
      )
        throw new Error('Invalid prototype layer identity');
      const descriptor = await readJson(
        path.join(cache.root, 'entries', pointer.entry, 'preview.json'),
      );
      if (descriptor.version !== 1 || !/^[a-f0-9]{64}$/.test(descriptor.sha256))
        throw new Error('Invalid prototype asset layer');
      return descriptor.sha256 as string;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return (await readLock()).sha256;
}
