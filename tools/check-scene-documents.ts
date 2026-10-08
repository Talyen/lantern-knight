import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseSceneDocument,
  validateSceneReferences,
  sceneBytesLimit,
} from '../src/content/scene-document';
import { baseWorldVisuals, resolveAuthoredScene } from '../src/content/world-art';
import type { Manifest } from '../src/assets/schema';
export async function checkSceneDocuments(root: string, manifests: ReadonlyMap<string, Manifest>) {
  const directory = path.join(root, 'authoring/scenes'),
    files = (await fs.readdir(directory)).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const location = path.join(directory, file);
    if (!(await fs.lstat(location)).isFile() || (await fs.stat(location)).size > sceneBytesLimit)
      throw new Error('Scene document must be a small regular file: ' + file);
    const d = parseSceneDocument(JSON.parse(await fs.readFile(location, 'utf8')));
    if (file !== d.id + '.json')
      throw new Error('Scene filename differs from its identity: ' + file);
    validateSceneReferences(d, baseWorldVisuals[d.base], manifests);
    resolveAuthoredScene(d);
  }
  return files.length;
}
