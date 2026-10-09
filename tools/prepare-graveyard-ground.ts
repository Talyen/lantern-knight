import { readAsset, writeAsset, mkdirAsset } from './assets/io';

import path from 'node:path';
import sharp from 'sharp';
import { compile, hash } from './compiler';
import overlayClips from '../authoring/ground-overlays.json';
import type { Source } from '../src/assets/schema';

const check = process.argv.includes('--check'),
  root = 'references/art/ink-collection-01';
const inputs: Record<string, string> = {};
async function pixels(file: string, brightness = 1, saturation = 1) {
  const b = await readAsset(file);
  inputs[file] = hash(b);
  return sharp(b)
    .modulate({ brightness, saturation })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}
const grass = await pixels('references/art/blackwood-churchyard-v2/quiet-earth.png', 0.88, 0.6);
const earth = await pixels('references/art/blackwood-churchyard-v2/quiet-earth.png', 1.02, 0.45);
const paving = await pixels(
  `${root}/Ground_Surfaces_Decals_r02a/png/materials/03_worn_cobble.png`,
  1.02,
  0.6,
);
const apron = await pixels(
  `${root}/Ground_Surfaces_Decals_r02a/png/materials/01_old_flagstone.png`,
  0.82,
  0.6,
);
const overlays = await Promise.all(
  overlayClips.map(async (clip) => ({
    placement: { clip },
    image: await pixels(
      `${root}/${clip.startsWith('t') ? 'Ground_Transitions/png/overlays' : 'Ground_Surfaces_Decals_r02a/png/decals'}/${clip}.png`,
      0.88,
      0.7,
    ),
  })),
);
async function write(file: string, b: Buffer | string) {
  if (check) {
    if (!Buffer.from(b).equals(await readAsset(file)))
      throw new Error(`stale graveyard ground: ${file}`);
  } else {
    await mkdirAsset(path.dirname(file), { recursive: true });
    await writeAsset(file, b);
  }
}
const template = JSON.parse(await readAsset('staging/ink/ink-moss.json', 'utf8')) as Source;
const materials: Source = {
  schemaVersion: 2,
  asset: {
    ...template.asset,
    id: 'ink-graveyard-materials',
    contentVersion: 'graveyard-v1',
    canvas: [1024, 1024],
    anchor: [512, 512],
    density: 256,
    atlasSize: 1024,
    padding: 0,
    sampling: 'terrain-mipmapped',
    recipe: 'graveyard-ground-materials-v1',
    clips: {},
    requiredClips: [],
  },
  frames: [],
};
for (const [id, im] of [
  ['grass', grass],
  ['earth', earth],
  ['paving', paving],
  ['apron', apron],
] as const) {
  const file = `ink/ink-graveyard-materials/${id}.png`;
  await write(
    `staging/${file}`,
    await sharp(im.data, { raw: im.info }).resize(1024, 1024).png().toBuffer(),
  );
  materials.frames.push({ id, path: file, origin: 'imported-study', attachments: {} });
  materials.asset.clips[id] = {
    d45: { frames: [id], durationsMs: [1000], loop: true, notifies: [] },
  };
  materials.asset.requiredClips.push(id);
}
await write('staging/ink/ink-graveyard-materials.json', JSON.stringify(materials, null, 2) + '\n');
const materialManifest = await compile(
  'ink/ink-graveyard-materials.json',
  'public/generated/ink/ink-graveyard-materials',
  false,
  check,
);
if (
  check &&
  JSON.stringify(materialManifest) !==
    JSON.stringify(
      JSON.parse(
        await readAsset('public/generated/ink/ink-graveyard-materials/manifest.json', 'utf8'),
      ),
    )
)
  throw new Error('stale graveyard materials');
const overlayPack: Source = {
  schemaVersion: 2,
  asset: {
    ...template.asset,
    id: 'ink-graveyard-overlays',
    type: 'prop',
    contentVersion: 'graveyard-v1',
    canvas: [1024, 1024],
    anchor: [512, 512],
    density: 256,
    atlasSize: 4096,
    renderCategory: 'translucent',
    occlusion: 'ground-plane-v1',
    sampling: undefined,
    recipe: 'graveyard-ground-overlays-v1',
    clips: {},
    requiredClips: [],
  },
  frames: [],
};
for (const { placement: p, image: im } of overlays) {
  const file = `ink/ink-graveyard-overlays/${p.clip}.png`;
  await write(`staging/${file}`, await sharp(im.data, { raw: im.info }).png().toBuffer());
  overlayPack.frames.push({ id: p.clip, path: file, origin: 'imported-study', attachments: {} });
  overlayPack.asset.clips[p.clip] = {
    d45: { frames: [p.clip], durationsMs: [1000], loop: true, notifies: [] },
  };
  overlayPack.asset.requiredClips.push(p.clip);
}
await write('staging/ink/ink-graveyard-overlays.json', JSON.stringify(overlayPack, null, 2) + '\n');
const overlayManifest = await compile(
  'ink/ink-graveyard-overlays.json',
  'public/generated/ink/ink-graveyard-overlays',
  false,
  check,
);
if (
  check &&
  JSON.stringify(overlayManifest) !==
    JSON.stringify(
      JSON.parse(
        await readAsset('public/generated/ink/ink-graveyard-overlays/manifest.json', 'utf8'),
      ),
    )
)
  throw new Error('stale graveyard overlays');
await write(
  'staging/ink/graveyard-ground-receipt.json',
  JSON.stringify(
    {
      recipe: 'blackwood-materials-v3',
      inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))),
      originalSourcesPreserved: true,
      runtimeSamplerSize: 1024,
    },
    null,
    2,
  ) + '\n',
);
