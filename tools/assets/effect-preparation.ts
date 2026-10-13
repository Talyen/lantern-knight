import path from 'node:path';
import sharp from 'sharp';
import { hash } from '../compiler';
import { source as definition } from './definition';
import { preparationOutput } from './preparation-output';
import type { Source } from '../../src/assets/schema';
import type { PreparationContext } from './context';

export function effectPreparation(
  context: PreparationContext,
  check: boolean,
  group: 'effects-playground' | 'visual-effects',
) {
  const { write, pack: outputPack } = preparationOutput(context, check);
  const root = 'references/art/ink-collection-01';
  const receipt: { file: string; hash: string }[] = [];
  function source(
    id: string,
    type: 'effect' | 'prop',
    canvas: [number, number],
    anchor: [number, number],
    density: number,
  ): Source {
    const pack = definition(id, type, canvas, anchor, density);
    Object.assign(pack.asset, {
      contentVersion: group === 'effects-playground' ? 'effects-lab-1' : 'visual-effects-1',
      projection: canvas[1] === 1536 ? 'painted-cutout' : 'projected-world',
      limitations: [
        group === 'effects-playground'
          ? 'Developer look-development scene; effects have no gameplay authority.'
          : 'Illustrated ambience; no gameplay authority.',
      ],
      provenance: {
        creator: 'Owner-supplied Lantern collection',
        license: 'Original owner-supplied artwork provenance retained',
        source: root,
      },
      recipe: group + '-v1',
      shadow: { radius: 0.3, opacity: 0.3 },
      occlusion: 'camera-card-v1',
      requiredClips: ['show'],
    });
    return pack;
  }
  async function frames(
    pack: Source,
    files: string[],
    durations: number[],
    loop: boolean,
    vector = false,
  ) {
    const ids = [];
    for (const [i, file] of files.entries()) {
      const input = await context.exactSource(file, root);
      receipt.push({ file, hash: hash(input) });
      const png = vector
        ? await sharp(input, { density: 216 }).ensureAlpha().png().toBuffer()
        : input;
      const id = `frame-${i}`,
        relative = `${group}/${pack.asset.id}/${id}.png`;
      await write(path.join('staging', relative), png);
      pack.frames.push({ id, path: relative, origin: 'imported-study', attachments: {} });
      ids.push(id);
    }
    pack.asset.clips.show = { d45: { frames: ids, durationsMs: durations, loop, notifies: [] } };
    await outputPack(pack, group, group === 'effects-playground' ? 'dev-effects' : group);
    console.log(`${check ? 'Verified' : 'Prepared'} ${pack.asset.id}: ${ids.length} frames`);
  }
  async function finish() {
    await write(
      `staging/${group}/receipt.json`,
      JSON.stringify({ recipe: group + '-v1', sourceFiles: receipt }, null, 2) + '\n',
    );
  }
  return { source, frames, write, finish };
}
