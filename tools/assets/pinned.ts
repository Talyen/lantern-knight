import { openRepositoryWorkspace } from './repository';
import { onAsyncExit } from '../scope-exit';
import path from 'node:path';
import { shaFile } from './sources';
import { AssetCache } from './cache';
import {
  type AssetLock,
  ensurePack,
  installMutex,
  installMatchingPreparation,
  validateCachedPack,
} from './pack';
import { ensureBundlePack, type AssetScope } from './bundles';
import { openFileWorkspace } from './file-delivery';
import { selectedFiles } from '../select-runtime-assets';

export async function acquirePinnedPack(
  lock: AssetLock,
  cache = new AssetCache(),
  scope: AssetScope = 'authoring',
  request: typeof fetch = fetch,
) {
  if (lock.schemaVersion === 5) return openRepositoryWorkspace(lock, scope, false);
  if (lock.schemaVersion !== 4)
    return lock.schemaVersion === 3
      ? ensureBundlePack(lock, cache, request, scope)
      : ensurePack(lock, cache, request);
  // Delivery format upgrades retain payload identity and can reuse existing
  // validated authoring packs or the exact reviewed local preparation.
  if (scope === 'authoring') {
    const held = await cache.lease('pack-' + lock.sha256 + '-authoring', 0, false, true);
    let reused = false;
    const validate = async () =>
      validateCachedPack(held.root, {
        ...lock,
        inventorySha256: await shaFile(path.join(held.root, 'pack.json')),
      });
    try {
      try {
        await validate();
        reused = true;
        return held;
      } catch {}
      await installMutex(held.root, async () => {
        try {
          await validate();
          reused = true;
        } catch {
          if (await held.sole()) reused = await installMatchingPreparation(held, lock, cache);
        }
      });
      if (reused) return held;
    } finally {
      if (!reused) await held.release();
    }
  }
  const workspace = await openFileWorkspace(lock, cache, request);
  let success = false;
  await using cleanup = onAsyncExit(async () => {
    if (!success) await workspace.release();
  });
  if (scope === 'authoring') await workspace.materializeAll();
  else
    await selectedFiles(workspace.publicDirectory, 'runtime', (file) =>
      workspace.ensurePublicFile(file),
    );
  success = true;
  return workspace;
}
