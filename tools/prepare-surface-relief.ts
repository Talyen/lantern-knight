import { readAsset, writeAsset, mkdirAsset } from './assets/io';

import path from 'node:path';
import sharp from 'sharp';
import { hash, exactSource } from './compiler';
import { normalPixels } from '../src/assets/normal-pixels';
import { assetCatalog } from '../src/content/asset-catalog';
import type { Manifest } from '../src/assets/schema';
const check = process.argv.includes('--check'),
  root = 'references/art/ink-collection-01',
  recipeBytes = await readAsset('authoring/surface-depth.json'),
  recipe = JSON.parse(recipeBytes.toString()),
  entries: Record<string, unknown> = {};
async function write(file: string, bytes: Buffer | string) {
  if (check) {
    if (!Buffer.from(bytes).equals(await readAsset(file)))
      throw new Error(`stale surface companion: ${file}`);
  } else {
    await mkdirAsset(path.dirname(file), { recursive: true });
    await writeAsset(file, bytes);
  }
}
for (const [id, s] of Object.entries(recipe.surfaces) as [
  string,
  { source: string; asset: string; frame: string; polygons: number[][][] },
][]) {
  const input = await exactSource(s.source, root),
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#777"/>${s.polygons.map((p) => `<polygon points="${p.map((v) => v.join(',')).join(' ')}" fill="#b3b3b3"/>`).join('')}</svg>`;
  const height = await sharp(Buffer.from(svg)).blur(2).greyscale().raw().toBuffer(),
    rgba = normalPixels(height, 512, 512, 9),
    png = await sharp(rgba, { raw: { width: 512, height: 512, channels: 4 } })
      .png()
      .toBuffer();
  const manifest = JSON.parse(
      await readAsset(path.join('public', assetCatalog[s.asset]!), 'utf8'),
    ) as Manifest,
    frame = manifest.frames.find((f) => f.id === s.frame)!,
    page = manifest.pages.find((p) => p.id === frame.page)!;
  await write(`public/visual-effects/${id}.png`, png);
  entries[id] = {
    file: `${id}.png`,
    hash: hash(png),
    source: s.source,
    sourceHash: hash(input),
    asset: s.asset,
    frame: s.frame,
    pageHash: page.hash,
    width: 512,
    height: 512,
  };
}
await write(
  'public/visual-effects/surfaces.json',
  JSON.stringify({ recipe: recipe.recipe, recipeHash: hash(recipeBytes), entries }, null, 2) + '\n',
);
console.log(`${check ? 'Verified' : 'Prepared'} hand-authored stone companions`);
