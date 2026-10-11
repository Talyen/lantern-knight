import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectRoot } from '../assets/paths';
import { openWorkspace } from '../assets/workspace';
import { readAuthoringCatalog } from '../assets/authoring-catalog';
import { parseManifest } from '../../src/assets/schema';
import { parseSceneDocument } from '../../src/content/scene-document';

const workspace = await openWorkspace('local', 'authoring');
try {
  const catalog = await readAuthoringCatalog(workspace.publicDirectory);
  const sceneDirectory = path.join(projectRoot, 'authoring/scenes');
  const scenes = new Map<string, string[]>();
  for (const file of await fs.readdir(sceneDirectory)) {
    if (!file.endsWith('.json')) continue;
    const d = parseSceneDocument(
      JSON.parse(await fs.readFile(path.join(sceneDirectory, file), 'utf8')),
    );
    scenes.set(d.floor.asset, [...(scenes.get(d.floor.asset) ?? []), d.id]);
  }
  const paintings = [];
  // Inventory the prepared authoring catalog, never the external source library.
  for (const [id, file] of Object.entries(catalog)) {
    if (!id.startsWith('library-')) continue;
    const m = parseManifest(
      JSON.parse(await fs.readFile(path.join(workspace.publicDirectory, file), 'utf8')),
    );
    if (
      m.asset.type !== 'material' ||
      m.asset.projection !== 'top-down' ||
      m.asset.imageRole !== 'scene-painting' ||
      Math.max(...m.asset.canvas) < 3840
    )
      continue;
    paintings.push({
      asset: id,
      name: m.asset.label,
      dimensions: m.asset.canvas,
      role: m.asset.imageRole,
      clips: Object.keys(m.asset.clips).filter(
        (clip) => m.asset.clips[clip]?.d45?.frames.length === 1,
      ),
      scenes: scenes.get(id) ?? [],
    });
  }
  const folder =
    process.env.LANTERN_SAM_ROOT ??
    path.join(os.homedir(), 'Library/Application Support/LanternKnight/segmentation');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'scene-inventory.json');
  await fs.writeFile(file, JSON.stringify(paintings, null, 2));
  console.log(
    `${paintings.length} 4K+ artwork grounds; ${paintings.filter((p) => p.scenes.length).length} already referenced by scenes. Inventory: ${file}`,
  );
} finally {
  await workspace.release();
}
