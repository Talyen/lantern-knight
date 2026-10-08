import { readAsset, writeAsset, mkdirAsset } from './assets/io';
import path from 'node:path';
import sharp from 'sharp';
import { compile, hash } from './compiler';
import type { Source } from '../src/assets/schema';
import contract from '../src/assets/camera.json';
import { graveyardExtraRegistration } from '../src/content/graveyard-registration';
const check = process.argv.includes('--check'),
  collection = 'references/art/ink-collection-01';
const receipts: Record<string, unknown>[] = [];
async function write(file: string, data: Buffer | string) {
  if (check) {
    if (!Buffer.from(data).equals(await readAsset(file)))
      throw new Error(`stale graveyard art: ${file}`);
  } else {
    await mkdirAsset(path.dirname(file), { recursive: true });
    await writeAsset(file, data);
  }
}
function make(template: Source, id: string): Source {
  return {
    schemaVersion: 2,
    asset: {
      ...template.asset,
      id,
      contentVersion: 'graveyard-v1',
      recipe: 'graveyard-art-v1',
      requiredClips: [],
      clips: {},
    },
    frames: [],
  };
}
async function still(
  pack: Source,
  id: string,
  file: string,
  pivot: readonly [number, number],
  scale: number,
  matte = false,
) {
  const original = await readAsset(file),
    meta = await sharp(original).metadata();
  let image = await sharp(original)
    .resize({ width: Math.round(meta.width! * scale), height: Math.round(meta.height! * scale) })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (matte)
    for (let i = 3; i < image.data.length; i += 4) {
      const a = image.data[i]! / 255,
        t = Math.max(0, Math.min(1, (a - 0.72) / 0.2));
      image.data[i] = Math.round(t * t * (3 - 2 * t) * 255);
    }
  const offset = [
    Math.round(pack.asset.anchor[0] - pivot[0] * scale),
    Math.round(pack.asset.anchor[1] - pivot[1] * scale),
  ];
  const png = await sharp({
    create: {
      width: pack.asset.canvas[0],
      height: pack.asset.canvas[1],
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp(image.data, { raw: image.info }).png().toBuffer(),
        left: offset[0]!,
        top: offset[1]!,
      },
    ])
    .png()
    .toBuffer();
  const name = `ink/${pack.asset.id}/${id}.png`;
  await write(`staging/${name}`, png);
  pack.frames.push({ id, path: name, origin: 'imported-study', attachments: {} });
  pack.asset.clips[id] = { d45: { frames: [id], durationsMs: [1000], loop: true, notifies: [] } };
  receipts.push({
    pack: pack.asset.id,
    id,
    source: file,
    sourceHash: hash(original),
    sourceCanvas: [meta.width, meta.height],
    uniformScale: scale,
    paddingOffset: offset,
    sourceAnchor: pivot,
    derivativeAnchor: pack.asset.anchor,
    density: pack.asset.density,
    ...(matte
      ? {
          alphaRemap: {
            floor: 0.72,
            ceiling: 0.92,
            reason:
              'Remove generated low-alpha backdrop contamination; preserve original PNG and re-antialias coverage',
          },
        }
      : {}),
  });
}
const template = JSON.parse(await readAsset('staging/ink/ink-scenery.json', 'utf8')) as Source;
const scenery = make(template, 'ink-graveyard-scenery');
for (const r of graveyardExtraRegistration) {
  const file = `${collection}/${r.file}`,
    im = await sharp(await readAsset(file))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  let minX = Infinity,
    maxX = -1,
    minY = Infinity,
    maxY = -1;
  for (let y = 0; y < im.info.height; y++)
    for (let x = 0; x < im.info.width; x++)
      if (im.data[(y * im.info.width + x) * 4 + 3]! > 200) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  const pivot: readonly [number, number] = 'pivot' in r ? r.pivot : [(minX + maxX) / 2, maxY],
    scale =
      (r.height * Math.cos((contract.elevationDeg * Math.PI) / 180) * scenery.asset.density) /
      (maxY - minY);
  await still(scenery, r.id, file, pivot, scale);
  Object.assign(receipts.at(-1)!, {
    physicalHeightMetres: r.height,
    measurementPixels: maxY - minY,
  });
}
const data = JSON.parse(
  (await readAsset(`${collection}/ambient_pack_v1/manifest.json`)).toString(),
);
const effectTemplate = JSON.parse(await readAsset('staging/ink/ink-cues.json', 'utf8')) as Source,
  ambient = make(effectTemplate, 'ink-ambient');
for (const clip of data.clips) {
  const id = clip.effect ?? clip.id.split('__')[0];
  if (!['lamp_flame', 'quiet_smoke', 'tumbling_leaf'].includes(id)) continue;
  const frames = [];
  for (const f of clip.frames) {
    const b = await readAsset(`${collection}/ambient_pack_v1/${f.svg}`),
      file = `ink/ink-ambient/${id}-${f.id}.png`;
    await write(`staging/${file}`, await sharp(b, { density: 216 }).ensureAlpha().png().toBuffer());
    const fid = `${id.replaceAll('_', '-')}-${f.id}`;
    frames.push(fid);
    ambient.frames.push({ id: fid, path: file, origin: 'imported-study', attachments: {} });
    receipts.push({
      pack: 'ink-ambient',
      id: fid,
      source: `${collection}/ambient_pack_v1/${f.svg}`,
      sourceHash: hash(b),
      uniformScale: 3,
      paddingOffset: [0, 0],
      density: 336,
    });
  }
  ambient.asset.clips[id] = {
    d45: {
      frames,
      durationsMs: clip.frames.map(
        (f: { durationRational?: number[]; durationSeconds?: number }) =>
          f.durationRational
            ? (1000 * f.durationRational[0]!) / f.durationRational[1]!
            : 1000 * f.durationSeconds!,
      ),
      loop: !!clip.loop,
      notifies: [],
    },
  };
}
for (const pack of [scenery, ambient]) {
  pack.asset.requiredClips = Object.keys(pack.asset.clips);
  const file = `ink/${pack.asset.id}.json`;
  await write(`staging/${file}`, JSON.stringify(pack, null, 2) + '\n');
  const expected = await compile(file, `public/generated/ink/${pack.asset.id}`, false, check);
  if (
    check &&
    JSON.stringify(expected) !==
      (await readAsset(`public/generated/ink/${pack.asset.id}/manifest.json`, 'utf8').then((t) =>
        JSON.stringify(JSON.parse(t)),
      ))
  )
    throw new Error(`stale compiled graveyard pack: ${pack.asset.id}`);
  console.log(`${check ? 'Verified' : 'Prepared'} ${pack.asset.id}`);
}
await write(
  'staging/ink/graveyard-art-receipt.json',
  JSON.stringify({ recipe: 'graveyard-art-v1', frames: receipts }, null, 2) + '\n',
);
