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
export async function checkSceneDocuments(root: string, publicDirectory: string) {
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
    const d = parseSceneDocument(JSON.parse(await fs.readFile(location, 'utf8')));
    if (file !== d.id + '.json')
      throw new Error('Scene filename differs from its identity: ' + file);
    const scene = resolveScene(d);
    catalog ??= await readAuthoringCatalog(publicDirectory);
    for (const id of scene.assets) {
      if (manifests.has(id)) continue;
      const source = catalog[id];
      if (!source) throw new Error('Unavailable scene asset: ' + id);
      const manifest = parseManifest(
        JSON.parse(await fs.readFile(path.join(publicDirectory, source), 'utf8')),
      );
      if (manifest.asset.id !== id) throw new Error('Scene asset identity differs: ' + id);
      manifests.set(id, manifest);
    }
    validateSceneReferences(d, manifests);
  }
  return files.length;
}
