import sharp from 'sharp';

import type { Manifest } from '../../../src/assets/schema';
import { hash } from '../../compiler';
import path from 'node:path';
import { readAuthoringCatalog } from '../authoring-catalog';
import type { PreparationContext } from '../context';
export async function prepare(context: PreparationContext, check = false) {
  const { readAsset, writeAsset } = context;

  const registration = JSON.parse(await readAsset('staging/ink/derivatives.json', 'utf8')).frames;
  const algorithm = hash(
    JSON.stringify([
      await readAsset('tools/assets/prepare/prepare-graveyard-coverage.ts', 'utf8'),
      sharp.versions,
    ]),
  );
  let prior: { algorithm?: string; keys?: Record<string, string> } = {};
  let coverage: { masks?: Record<string, { width: number; height: number; alpha: number[] }> } = {};
  try {
    prior = JSON.parse(await readAsset('metadata/ink/coverage-inputs.json', 'utf8'));
    coverage = JSON.parse(await readAsset('public/registration.json', 'utf8')).coverage;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const keys: Record<string, string> = {};
  const masks: Record<string, { width: number; height: number; alpha: number[] }> = {},
    sources: Record<string, string> = {},
    sockets: Record<string, number[][]> = {};
  for (const [id, file] of Object.entries(
    await readAuthoringCatalog(context.publicDirectory, { includeDeveloperAssets: false }),
  )) {
    const m = JSON.parse(await readAsset('public/' + file, 'utf8')) as Manifest;
    if (m.asset.type !== 'prop') continue;
    for (const frame of m.frames) {
      const library = id.startsWith('library-'),
        page = m.pages.find((p) => p.id === frame.page)!,
        source = library
          ? path.posix.join('public', path.posix.dirname(file), page.path)
          : 'staging/' + frame.source,
        [left, top, width, height] = library ? frame.rect : frame.trim;
      let sourceHash = await context.verifiedHash(source);
      let b: Buffer | undefined;
      if (!sourceHash) {
        b = await readAsset(source);
        sourceHash = hash(b);
      }
      const idKey = `${id}:${frame.id}`;
      const key = hash(JSON.stringify([sourceHash, left, top, width, height]));
      keys[idKey] = key;
      const cached =
        prior.algorithm === algorithm && prior.keys?.[idKey] === key
          ? coverage.masks?.[idKey]
          : undefined;
      if (cached) masks[idKey] = cached;
      else {
        b ??= await readAsset(source);
        if (hash(b) !== sourceHash) throw new Error('Coverage source changed: ' + source);
        const raw = await sharp(b)
          .ensureAlpha()
          .extract({ left, top, width, height })
          .extractChannel('alpha')
          .resize(32, 32, { kernel: 'linear' })
          .raw()
          .toBuffer();
        masks[`${id}:${frame.id}`] = { width: 32, height: 32, alpha: [...raw] };
      }
      if (id === 'ink-scenery' && frame.id === 'arch') {
        const r = registration.find(
          (r: { pack: string; id: string }) => r.pack === id && r.id === frame.id,
        );
        sockets['ink-scenery:arch'] = [
          [365, 1120],
          [945, 1260],
        ].map(([x, y]) => [
          (x! * r.uniformScale + r.paddingOffset[0] - left) / width,
          (y! * r.uniformScale + r.paddingOffset[1] - top) / height,
        ]);
      }
      sources[idKey] = sourceHash;
    }
  }
  const output = 'staging/ink/graveyard-coverage.json',
    text =
      JSON.stringify({ recipe: 'alpha-coverage32-v1', masks, sockets, sources }, null, 2) + '\n';
  if (check) {
    if (text !== (await readAsset(output, 'utf8'))) throw new Error('stale graveyard coverage');
  } else await writeAsset(output, text);
  if (!check)
    await writeAsset('staging/ink/coverage-inputs.json', JSON.stringify({ algorithm, keys }));
  console.log(
    `${check ? 'Verified' : 'Prepared'} ${Object.keys(masks).length} alpha-aware scenery masks`,
  );
}
