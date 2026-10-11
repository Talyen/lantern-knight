import fs from 'node:fs/promises';
import path from 'node:path';
import { parseSceneDocument } from '../../src/content/scene-document';
import { parseManifest } from '../../src/assets/schema';
import type { MaskShape } from '../../src/content/ground-interaction';
import { projectRoot } from '../assets/paths';
import { openWorkspace } from '../assets/workspace';
import { readAuthoringCatalog } from '../assets/authoring-catalog';
import { SegmentationService } from './service';

const id = process.argv[2];
const text = process.argv[3] ?? 'pine tree. dead tree. stone wall. large rock.';
if (!id || !/^[a-z][a-z0-9-]{0,63}$/.test(id))
  throw new Error('Use segmentation:propose -- <scene-id> [object categories]');
if (!text.trim() || text.length > 300)
  throw new Error('Use 1–300 characters of object categories.');
const scene = parseSceneDocument(
  JSON.parse(await fs.readFile(path.join(projectRoot, 'authoring/scenes', id + '.json'), 'utf8')),
);
if (scene.floor.layout !== 'artwork') throw new Error('Scene needs a single-image artwork floor.');
const workspace = await openWorkspace('local', 'authoring');
const service = new SegmentationService(projectRoot, workspace.publicDirectory);
const abort = new AbortController();
const cancel = () => abort.abort(new Error('Scenery proposal job cancelled'));
process.once('SIGINT', cancel);
type Candidate = {
  name: string;
  score: number;
  box: [number, number, number, number];
  mask?: MaskShape[];
  milliseconds?: number;
  device?: string;
};
type Result = { mask: MaskShape[]; candidates?: Candidate[]; milliseconds: number; device: string };
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
  const identity = { asset: manifest.asset.id, frame: frame.id, hash: page.hash };
  const settings = JSON.parse(
    await fs.readFile(path.join(service.modelRoot, 'settings.json'), 'utf8'),
  );
  const folder = path.join(service.modelRoot, 'jobs', id + '-' + page.hash.slice(0, 12));
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'proposals.json');
  const signature = JSON.stringify({ identity, settings, text, algorithm: 1 });
  let candidates: Candidate[];
  try {
    const old = JSON.parse(await fs.readFile(file, 'utf8'));
    const previous = JSON.parse(old.signature);
    previous.text ??= 'pine tree. dead tree. stone wall. large rock.';
    if (
      JSON.stringify(previous.identity) !== JSON.stringify(identity) ||
      JSON.stringify(previous.settings) !== JSON.stringify(settings) ||
      previous.text !== text ||
      previous.algorithm !== 1
    )
      throw new Error('Proposal inputs changed');
    candidates = old.candidates;
  } catch {
    const result = (await service.select(
      {
        ...identity,
        crop: [0, 0, 1, 1],
        operation: 'detect',
        text,
      },
      abort.signal,
    )) as Result;
    candidates = result.candidates ?? [];
    console.log(
      `Found ${candidates.length} candidates in ${result.milliseconds} ms · ${result.device}`,
    );
  }
  const save = async () => {
    await fs.writeFile(
      file + '.tmp',
      JSON.stringify({ signature, identity, dimensions: manifest.asset.canvas, candidates }),
    );
    await fs.rename(file + '.tmp', file);
  };
  await save();
  for (const [index, candidate] of candidates.entries()) {
    abort.signal.throwIfAborted();
    if (candidate.mask) continue;
    const [a, b, c, d] = candidate.box,
      padding = 0.025;
    const result = (await service.select(
      {
        ...identity,
        box: candidate.box,
        crop: [
          Math.max(0, a - padding),
          Math.max(0, b - padding),
          Math.min(1, c + padding),
          Math.min(1, d + padding),
        ],
      },
      abort.signal,
    )) as Result;
    candidate.mask = result.mask;
    candidate.device = result.device;
    candidate.milliseconds = result.milliseconds;
    await save();
    console.log(
      `${index + 1}/${candidates.length} ${candidate.name}: ${result.mask.length} islands · ${result.milliseconds} ms · ${result.device}`,
    );
  }
  console.log(`Proposals ready for agent review: ${file}. Authored scene unchanged.`);
} finally {
  process.removeListener('SIGINT', cancel);
  service.dispose();
  await workspace.release();
}
