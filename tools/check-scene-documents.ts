import { readJson } from './json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseSceneDocument,
  validateSceneReferences,
  sceneBytesLimit,
} from '../src/content/scene-document';
import { resolveScene } from '../src/content/world-art';
import { parseManifest, type Manifest } from '../src/assets/schema';
import { readAuthoringCatalog } from './assets/authoring-catalog';
import { GroundProfileStore } from './scene/ground-profile-store';
import { spawnPlacementAssets } from '../src/content/scene-placement';
export async function checkSceneDocuments(
  root: string,
  publicDirectory: string,
  options: { allowUnpreparedDraftGround?: boolean } = {},
) {
  // Archived profiles remain valid even when their original asset is no longer prepared.
  const profileDirectory = path.join(root, 'authoring/ground-profiles');
  try {
    await fs.access(profileDirectory);
    const profiles = await new GroundProfileStore(profileDirectory).list();
    const unreadable = profiles.find((profile) => profile.error);
    if (unreadable) throw new Error(`Ground profile ${unreadable.id}: ${unreadable.error}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const directory = path.join(root, 'authoring/scenes'),
    files = (
      await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })
    ).filter((f) => f.endsWith('.json'));
  let catalog: Readonly<Record<string, string>> | undefined;
  const manifests = new Map<string, Manifest>();
  for (const file of files) {
    const location = path.join(directory, file);
    if (!(await fs.lstat(location)).isFile() || (await fs.stat(location)).size > sceneBytesLimit)
      throw new Error('Scene document must be a small regular file: ' + file);
    const d = parseSceneDocument(await readJson(location));
    if (file !== d.id + '.json')
      throw new Error('Scene filename differs from its identity: ' + file);
    const scene = resolveScene(d);
    catalog ??= await readAuthoringCatalog(publicDirectory);
    for (const id of new Set([...scene.assets, ...spawnPlacementAssets(d)])) {
      if (manifests.has(id)) continue;
      const source = catalog[id];
      if (!source) {
        if (
          options.allowUnpreparedDraftGround &&
          d.target === 'draft' &&
          d.floor.layout === 'artwork' &&
          id === d.floor.asset
        )
          continue;
        throw new Error('Unavailable scene asset: ' + id);
      }
      const manifest = parseManifest(await readJson(path.join(publicDirectory, source)));
      if (manifest.asset.id !== id) throw new Error('Scene asset identity differs: ' + id);
      manifests.set(id, manifest);
    }
    validateSceneReferences(d, manifests, options);
  }
  return files.length;
}
