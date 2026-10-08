import { readAsset, writeAsset } from './assets/io';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { assetCatalog } from '../src/content/asset-catalog';
import type { Manifest } from '../src/assets/schema';
import { hash } from './compiler';
const registration = JSON.parse(await readAsset('staging/ink/derivatives.json', 'utf8')).frames;
const check = process.argv.includes('--check'),
  masks: Record<string, { width: number; height: number; alpha: number[] }> = {},
  sources: Record<string, string> = {},
  sockets: Record<string, number[][]> = {};
for (const [id, file] of Object.entries(assetCatalog)) {
  const m = JSON.parse(await readAsset('public/' + file, 'utf8')) as Manifest;
  if (m.asset.type !== 'prop') continue;
  for (const frame of m.frames) {
    const b = await readAsset('staging/' + frame.source),
      [left, top, width, height] = frame.trim;
    const raw = await sharp(b)
      .extract({ left, top, width, height })
      .extractChannel('alpha')
      .resize(32, 32, { kernel: 'linear' })
      .raw()
      .toBuffer();
    masks[`${id}:${frame.id}`] = { width: 32, height: 32, alpha: [...raw] };
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
    sources[`${id}:${frame.id}`] = hash(b);
  }
}
const output = 'staging/ink/graveyard-coverage.json',
  text = JSON.stringify({ recipe: 'alpha-coverage32-v1', masks, sockets, sources }, null, 2) + '\n';
if (check) {
  if (text !== (await readAsset(output, 'utf8'))) throw new Error('stale graveyard coverage');
} else await writeAsset(output, text);
console.log(
  `${check ? 'Verified' : 'Prepared'} ${Object.keys(masks).length} alpha-aware scenery masks`,
);
