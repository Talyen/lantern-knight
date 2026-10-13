import path from 'node:path';
import { AssetCache } from './cache';
import { type AssetLock } from './pack';
import { ensureBundlePack } from './bundles';
import { openFileWorkspace } from './file-delivery';

// Current pins select individual authenticated files. Older pins use the same
// complete-bundle acquisition as builds, rather than a second archive reader.
export async function openDemandWorkspace(
  pin: Extract<AssetLock, { schemaVersion: 3 }>,
  cache = new AssetCache(),
  request: typeof fetch = fetch,
) {
  if (pin.fileDelivery) return openFileWorkspace(pin, cache, request);
  const held = await ensureBundlePack(pin, cache, request);
  return {
    root: held.root,
    publicDirectory: path.join(held.root, 'public'),
    metadataDirectory: path.join(held.root, 'metadata'),
    identity: pin.sha256,
    recipe: pin.recipeSha256,
    scope: 'authoring' as const,
    ensurePublicFile: undefined,
    release: () => held.release(),
  };
}
