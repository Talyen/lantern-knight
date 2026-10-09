import { readAsset, writeAsset, mkdirAsset } from './assets/io';

import sharp from 'sharp';
import { compile, hash } from './compiler';
import type { Source } from '../src/assets/schema';
import contract from '../src/assets/camera.json';
const check = process.argv.includes('--check'),
  root = 'references/art/blackwood-churchyard-v2',
  receipt = [];
const template = JSON.parse(await readAsset('staging/ink/ink-scenery.json', 'utf8')) as Source;
for (const [id, file, kind] of [
  ['ink-chapel-front', 'chapel-front.png', 'facade'],
  ['ink-blackwood-oak', 'ancient-oak.png', 'oak'],
  ['ink-churchyard-roof', 'slate-roof.png', 'roof'],
  ['ink-blackwood-woodland', 'woodland-group.png', 'woodland'],
] as const) {
  const b = await readAsset(`${root}/${file}`),
    raw = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = raw.info.width,
    maxX = 0,
    minY = raw.info.height,
    maxY = 0;
  for (let y = 0; y < raw.info.height; y++)
    for (let x = 0; x < raw.info.width; x++)
      if (raw.data[(y * raw.info.width + x) * 4 + 3]! > 180) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  const source: Source = {
    schemaVersion: 2,
    asset: {
      ...template.asset,
      id,
      type: kind === 'roof' ? 'material' : 'prop',
      canvas: kind === 'roof' ? [1024, 1024] : [raw.info.width, raw.info.height],
      sampling: kind === 'roof' ? 'terrain-mipmapped' : undefined,
      anchor:
        kind === 'roof'
          ? [512, 512]
          : kind === 'oak' || kind === 'woodland'
            ? [(minX + maxX) / 2, maxY]
            : [raw.info.width / 2, raw.info.height],
      density:
        kind === 'oak' || kind === 'woodland'
          ? (maxY - minY) /
            ((kind === 'woodland' ? 4.1 : 5.8) * Math.cos((contract.elevationDeg * Math.PI) / 180))
          : 256,
      atlasSize: kind === 'roof' ? 1024 : 2048,
      projection:
        kind === 'roof' ? 'top-down' : kind === 'facade' ? 'front-view' : 'painted-cutout',
      renderCategory: kind === 'roof' ? 'opaque' : 'cutout',
      contentVersion: 'blackwood-v2',
      provenance: {
        creator:
          'Built-in image_gen; canonical Clean INK prompt; model requested gpt-image-2.5 sunburst; routing not exposed',
        license: 'Owner-authorized project artwork',
        source: root,
      },
      recipe: 'blackwood-kit-v2',
      requiredClips: [kind],
      clips: { [kind]: { d45: { frames: [kind], durationsMs: [1000], loop: true, notifies: [] } } },
    },
    frames: [
      { id: kind, path: `ink/${id}/${kind}.png`, origin: 'imported-study', attachments: {} },
    ],
  };
  const folder = `staging/ink/${id}`;
  await mkdirAsset(folder, { recursive: true });
  const staged = await (kind === 'roof' ? sharp(b).resize(1024, 1024) : sharp(b))
      .ensureAlpha()
      .png()
      .toBuffer(),
    json = JSON.stringify(source, null, 2) + '\n';
  if (check) {
    if (
      !staged.equals(await readAsset(`${folder}/${kind}.png`)) ||
      json !== (await readAsset(`staging/ink/${id}.json`, 'utf8'))
    )
      throw new Error(`stale kit ${id}`);
  } else {
    await writeAsset(`${folder}/${kind}.png`, staged);
    await writeAsset(`staging/ink/${id}.json`, json);
  }
  const m = await compile(`ink/${id}.json`, `public/generated/ink/${id}`, false, check);
  if (
    check &&
    JSON.stringify(m) !==
      JSON.stringify(
        JSON.parse(await readAsset(`public/generated/ink/${id}/manifest.json`, 'utf8')),
      )
  )
    throw new Error(`stale kit manifest ${id}`);
  receipt.push({
    id,
    file,
    sha256: hash(b),
    width: raw.info.width,
    height: raw.info.height,
    density: source.asset.density,
  });
  console.log(`${check ? 'Verified' : 'Prepared'} ${id}`);
}
const groundBytes = await readAsset(`${root}/quiet-earth.png`),
  groundInfo = await sharp(groundBytes).metadata();
receipt.push({
  id: 'ink-graveyard-materials',
  file: 'quiet-earth.png',
  sha256: hash(groundBytes),
  width: groundInfo.width!,
  height: groundInfo.height!,
  density: 256,
});
if (!check)
  await writeAsset(
    'staging/ink/churchyard-source-proof.json',
    JSON.stringify(
      {
        tool: 'built-in image_gen',
        requestedModel: 'gpt-image-2.5 sunburst',
        modelRoutingExposed: false,
        requestedResolution: 'highest supported native',
        sizeControlExposed: false,
        originalsPreserved: true,
        assets: receipt,
      },
      null,
      2,
    ) + '\n',
  );
