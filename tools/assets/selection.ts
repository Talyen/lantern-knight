import fs from 'node:fs/promises';
import path from 'node:path';
import { authoringBaseCatalog } from '../../src/content/asset-catalog';
import { gameAssetCatalog } from '../../src/content/game-content';
import { parseSceneDocument } from '../../src/content/scene-document';
import { sceneAssets } from '../../src/content/world-visuals';
import { resolveSceneDocument } from '../../src/content/scene-document';
import { projectRoot } from './paths';

// Saved scenes are authoritative even when they are not registered in Game.
// Fixed authoring fixtures retain the assets their shipped tools still request.
export async function retainedAssetCatalog(
  available: Readonly<Record<string, string>> = {},
  root = projectRoot,
  additional: readonly string[] = [],
) {
  const ids = new Set([
    ...Object.keys(authoringBaseCatalog),
    ...Object.keys(gameAssetCatalog),
    ...additional,
  ]);
  let retained: { assets: string[] } = { assets: [] };
  try {
    retained = JSON.parse(await fs.readFile(path.join(root, 'assets/retained.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const id of retained.assets) ids.add(id);
  const directory = path.join(root, 'authoring/scenes');
  for (const name of (await fs.readdir(directory)).filter((name) => name.endsWith('.json'))) {
    const document = parseSceneDocument(
      JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')),
    );
    for (const id of sceneAssets(resolveSceneDocument(document))) ids.add(id);
  }
  return Object.fromEntries(
    [...ids].sort().map((id) => {
      const file =
        authoringBaseCatalog[id] ??
        gameAssetCatalog[id] ??
        available[id] ??
        (/^library-[a-z0-9_-]+$/.test(id) ? `generated/library/${id}/manifest.json` : undefined);
      if (!file) throw new Error('Saved scene requires an undeclared asset: ' + id);
      return [id, file];
    }),
  );
}
