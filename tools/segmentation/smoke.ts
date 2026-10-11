import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSceneDocument } from '../../src/content/scene-document';
import { parseManifest } from '../../src/assets/schema';
import { readAuthoringCatalog } from '../assets/authoring-catalog';
import { projectRoot } from '../assets/paths';
import { openWorkspace } from '../assets/workspace';
import { SegmentationService } from './service';
const id = process.argv[2];
if (!id || !/^[a-z][a-z0-9-]{0,63}$/.test(id))
  throw new Error('Use segmentation:smoke -- <scene-id>');
const scene = parseSceneDocument(
  JSON.parse(await fs.readFile(path.join(projectRoot, 'authoring/scenes', id + '.json'), 'utf8')),
);
if (scene.floor.layout !== 'artwork') throw new Error('Scene needs a single-image artwork floor.');
const workspace = await openWorkspace('local', 'authoring');
const service = new SegmentationService(projectRoot, workspace.publicDirectory);
try {
  const catalog = await readAuthoringCatalog(workspace.publicDirectory);
  const manifest = parseManifest(
    JSON.parse(
      await fs.readFile(path.join(workspace.publicDirectory, catalog[scene.floor.asset]!), 'utf8'),
    ),
  );
  const frame = manifest.frames.find(
    (f) => f.id === manifest.asset.clips[scene.floor.clip ?? 'still']?.d45?.frames[0],
  );
  const page = manifest.pages.find((p) => p.id === frame?.page);
  if (!frame || !page) throw new Error('Missing ground frame');
  const ground = { asset: manifest.asset.id, frame: frame.id, hash: page.hash };
  for (const prompt of [
    { box: [0.005, 0.005, 0.065, 0.19] },
    { points: [{ uv: [0.036, 0.12], include: true }] },
  ]) {
    const result = (await service.select(
      {
        asset: ground.asset,
        hash: ground.hash,
        frame: ground.frame,
        crop: [0, 0, 0.15, 0.28],
        ...prompt,
      },
      new AbortController().signal,
    )) as { mask: unknown[]; device: string; milliseconds: number };
    if (!result.mask.length) throw new Error('Real local inference returned no contours');
    console.log(
      JSON.stringify({
        prompt: 'box' in prompt ? 'box' : 'point',
        device: result.device,
        milliseconds: result.milliseconds,
        islands: result.mask.length,
      }),
    );
  }
} finally {
  service.dispose();
  await workspace.release();
}
