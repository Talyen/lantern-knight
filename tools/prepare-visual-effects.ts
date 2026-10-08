import { readAsset, writeAsset, mkdirAsset } from './assets/io';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compile, hash, exactSource } from './compiler';
import type { Source } from '../src/assets/schema';
import contract from '../src/assets/camera.json';

const root = 'references/art/ink-collection-01',
  check = process.argv.includes('--check');
const receipt: { file: string; hash: string }[] = [];
async function write(file: string, data: Buffer | string) {
  if (check) {
    if (!Buffer.from(data).equals(await readAsset(file)))
      throw new Error(`stale playground derivative: ${file}`);
  } else {
    await mkdirAsset(path.dirname(file), { recursive: true });
    await writeAsset(file, data);
  }
}
function source(
  id: string,
  type: 'effect' | 'prop',
  canvas: [number, number],
  anchor: [number, number],
  density: number,
): Source {
  return {
    schemaVersion: 2,
    asset: {
      id,
      type,
      schemaVersion: 2,
      contentVersion: 'visual-effects-1',
      bundle: 'room',
      status: 'proxy',
      viewMode: 'fixed-authored',
      projection: canvas[1] === 1536 ? 'painted-cutout' : 'projected-world',
      allowEmptyFrames: type === 'effect',
      atlasSize: 2048,
      limitations: ['Illustrated ambience; no gameplay authority.'],
      provenance: {
        creator: 'Owner-supplied Lantern collection',
        license: 'Original owner-supplied artwork provenance retained',
        source: root,
      },
      contractId: contract.id,
      bakeVersion: contract.bakeVersion,
      canvas,
      density,
      anchor,
      padding: 4,
      colorSpace: 'srgb',
      alpha: 'straight',
      recipe: 'visual-effects-v1',
      designReference: 'collection-study',
      renderStyle: 'clean-ink',
      renderCategory: type === 'effect' ? 'translucent' : 'cutout',
      shadow: { radius: 0.3, opacity: 0.3 },
      collisionFootprint: 'none',
      occlusion: 'camera-card-v1',
      fallbacks: {},
      dependencies: [],
      requiredClips: ['show'],
      clips: {},
    },
    frames: [],
  };
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
    const input = await exactSource(file, root);
    receipt.push({ file, hash: hash(input) });
    const png = vector
      ? await sharp(input, { density: 216 }).ensureAlpha().png().toBuffer()
      : input;
    const id = `frame-${i}`,
      relative = `visual-effects/${pack.asset.id}/${id}.png`;
    await write(path.join('staging', relative), png);
    pack.frames.push({ id, path: relative, origin: 'imported-study', attachments: {} });
    ids.push(id);
  }
  pack.asset.clips.show = { d45: { frames: ids, durationsMs: durations, loop, notifies: [] } };
  const sourcePath = `visual-effects/${pack.asset.id}.json`;
  await write(path.join('staging', sourcePath), JSON.stringify(pack, null, 2) + '\n');
  const out = `public/generated/visual-effects/${pack.asset.id}`,
    manifest = await compile(sourcePath, out, false, check);
  if (check) {
    if (
      JSON.stringify(manifest) !==
      JSON.stringify(JSON.parse(await readAsset(`${out}/manifest.json`, 'utf8')))
    )
      throw new Error(`stale playground pack ${pack.asset.id}`);
    for (const page of manifest.pages)
      if (hash(await readAsset(path.join(out, page.path))) !== page.hash)
        throw new Error('playground page changed');
  }
  console.log(`${check ? 'Verified' : 'Prepared'} ${pack.asset.id}: ${ids.length} frames`);
}

for (const [id, clipId] of [
  ['smoke', 'quiet_smoke'],
  ['embers', 'rising_motes'],
  ['splash', 'droplet_splash'],
  ['ripple', 'pond_ripple'],
] as const) {
  const data = JSON.parse((await exactSource('ambient_pack_v1/manifest.json', root)).toString()),
    clip = data.clips.find((c: { id: string }) => c.id === clipId);
  await frames(
    source(`fx-${id}`, 'effect', [1536, 1344], [768, 858], 336),
    clip.frames.map((f: { svg: string }) => `ambient_pack_v1/${f.svg}`),
    clip.frames.map(
      (f: { durationRational: number[] }) =>
        (1000 * f.durationRational[0]!) / f.durationRational[1]!,
    ),
    !!clip.loop,
    true,
  );
}
await write(
  'staging/visual-effects/receipt.json',
  JSON.stringify({ recipe: 'visual-effects-v1', sourceFiles: receipt }, null, 2) + '\n',
);
