import { readAsset, writeAsset, mkdirAsset } from './assets/io';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compile, hash } from './compiler';
import { worldVisuals } from '../src/content/world-art';
const graveyardArt = worldVisuals.court!;
import { clearing, pavingIslands } from '../src/content/graveyard-layout';
import type { Source } from '../src/assets/schema';

const check = process.argv.includes('--check'),
  root = 'references/art/ink-collection-01',
  size = 2048,
  density = 256;
const layout = { asset: 'ink-graveyard-ground-proof', min: -16, tileSize: 8, count: 4 },
  inputs: Record<string, string> = {};
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
const soil = await pixels('references/art/lanternkeepers-rest-v1/grave-soil-v1.png', 1.1, 0.65);
const overlays = await Promise.all(
  graveyardArt.decals.map(async (p) => ({
    placement: p,
    image: await pixels(
      `${root}/${p.clip.startsWith('t') ? 'Ground_Transitions/png/overlays' : 'Ground_Surfaces_Decals_r02a/png/decals'}/${p.clip}.png`,
      0.88,
      0.7,
    ),
  })),
);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function sample(im: typeof grass, x: number, z: number, repeat = 4) {
  const u = (((x / repeat) % 1) + 1) % 1,
    v = (((z / repeat) % 1) + 1) % 1;
  return (Math.floor(v * im.info.height) * im.info.width + Math.floor(u * im.info.width)) * 4;
}
function pathGap(x: number, z: number) {
  let nearest = Infinity;
  for (const route of graveyardArt.paths)
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!,
        b = route.points[i]!,
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
      const width = route.widths
        ? route.widths[i - 1]! + (route.widths[i]! - route.widths[i - 1]!) * t
        : route.width;
      nearest = Math.min(nearest, Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - width / 2);
    }
  return nearest;
}
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
const source: Source = {
  schemaVersion: 2,
  asset: {
    ...template.asset,
    id: layout.asset,
    contentVersion: 'graveyard-v1',
    canvas: [size, size],
    anchor: [size / 2, size / 2],
    density,
    atlasSize: size,
    padding: 0,
    sampling: 'terrain-mipmapped',
    recipe: 'graveyard-ground-v1',
    provenance: {
      ...template.asset.provenance,
      source: 'references/art/ink-collection-01; graveyard-scene.ts authored composition',
    },
    clips: {},
    requiredClips: [],
  },
  frames: [],
};
for (let tz = 0; tz < layout.count; tz++)
  for (let tx = 0; tx < layout.count; tx++) {
    const raw = Buffer.alloc(size * size * 4),
      left = layout.min + tx * layout.tileSize,
      top = layout.min + tz * layout.tileSize;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const wx = left + (x + 0.5) / density,
          wz = top + (y + 0.5) / density,
          index = (y * size + x) * 4;
        const field =
          (Math.sin(wx * 0.43 + wz * 0.31) +
            Math.sin(wx * 0.19 - wz * 0.58) * 0.55 +
            Math.sin(wx * 0.91 + wz * 0.77) * 0.18) /
          1.73;
        const outside = smooth(7, 15, Math.max(Math.abs(wx), Math.abs(wz))),
          damp = smooth(4.7, 6.7, Math.abs(wx));
        const earthMix = clamp(0.14 + field * 0.13 + damp * 0.12 + outside * 0.2),
          g = sample(grass, wx, wz),
          e = sample(earth, wx, wz);
        let r = grass.data[g]! * (1 - earthMix) + earth.data[e]! * earthMix,
          gg = grass.data[g + 1]! * (1 - earthMix) + earth.data[e + 1]! * earthMix,
          b = grass.data[g + 2]! * (1 - earthMix) + earth.data[e + 2]! * earthMix;
        const gap =
            pathGap(wx, wz) + (Math.sin(wx * 11 + wz * 7) + Math.sin(wx * 23 - wz * 17)) * 0.025,
          route = 1 - smooth(-0.035, 0.07, gap),
          pa = sample(paving, wx, wz, 4),
          threshold = clamp(Math.min(wx + 1.55, 1.55 - wx, wz + 6.5, -5.25 - wz) / 0.05),
          ap = sample(apron, wx, wz, 4);
        const stone = route * (1 - threshold) + threshold;
        r =
          r * (1 - stone) +
          (paving.data[pa]! * (1 - threshold) + apron.data[ap]! * threshold) * stone;
        gg =
          gg * (1 - stone) +
          (paving.data[pa + 1]! * (1 - threshold) + apron.data[ap + 1]! * threshold) * stone;
        b =
          b * (1 - stone) +
          (paving.data[pa + 2]! * (1 - threshold) + apron.data[ap + 2]! * threshold) * stone;
        for (const plot of graveyardArt.graves) {
          const a = plot.angle ?? 0,
            dx = wx - plot.x,
            dz = wz - plot.z,
            lx = dx * Math.cos(a) - dz * Math.sin(a),
            lz = dx * Math.sin(a) + dz * Math.cos(a);
          if (Math.abs(lx) > plot.width / 2 || Math.abs(lz) > plot.length / 2) continue;
          const sx = Math.min(
              soil.info.width - 1,
              Math.floor((lx / plot.width + 0.5) * soil.info.width),
            ),
            sy = Math.min(
              soil.info.height - 1,
              Math.floor((lz / plot.length + 0.5) * soil.info.height),
            ),
            n = (sy * soil.info.width + sx) * 4;
          const opacity =
            (soil.data[n + 3]! / 255) *
            (plot.age === 'kept' ? 0.7 : plot.age === 'damaged' ? 0.38 : 0.2) *
            (1 - stone);
          r = r * (1 - opacity) + soil.data[n]! * opacity;
          gg = gg * (1 - opacity) + soil.data[n + 1]! * opacity;
          b = b * (1 - opacity) + soil.data[n + 2]! * opacity;
        }
        for (const { placement: p, image: im } of overlays) {
          const scale = p.scale ?? 1,
            a = p.rotation ?? 0,
            dx = wx - p.x,
            dz = wz - p.z,
            lx = dx * Math.cos(a) - dz * Math.sin(a),
            lz = dx * Math.sin(a) + dz * Math.cos(a),
            w = 4 * scale;
          if (Math.abs(lx) > w / 2 || Math.abs(lz) > w / 2) continue;
          const sx = Math.min(im.info.width - 1, Math.floor((lx / w + 0.5) * im.info.width)),
            sy = Math.min(im.info.height - 1, Math.floor((lz / w + 0.5) * im.info.height)),
            n = (sy * im.info.width + sx) * 4,
            alpha = im.data[n + 3]! / 255;
          r = r * (1 - alpha) + im.data[n]! * alpha;
          gg = gg * (1 - alpha) + im.data[n + 1]! * alpha;
          b = b * (1 - alpha) + im.data[n + 2]! * alpha;
        }
        raw[index] = Math.round(r);
        raw[index + 1] = Math.round(gg);
        raw[index + 2] = Math.round(b);
        raw[index + 3] = 255;
      }
    const id = `tile-${tx}-${tz}`,
      file = `ink/${layout.asset}/${id}.png`;
    await write(
      `staging/${file}`,
      await sharp(raw, { raw: { width: size, height: size, channels: 4 } })
        .png()
        .toBuffer(),
    );
    source.frames.push({ id, path: file, origin: 'imported-study', attachments: {} });
    source.asset.clips[id] = {
      d45: { frames: [id], durationsMs: [1000], loop: true, notifies: [] },
    };
    source.asset.requiredClips.push(id);
    console.log(`${check ? 'Verified' : 'Composed'} ${id}`);
  }
if (source.frames.length) {
  const file = `ink/${layout.asset}.json`;
  await write(`staging/${file}`, JSON.stringify(source, null, 2) + '\n');
  const expected = await compile(file, `public/generated/ink/${layout.asset}`, false, check);
  if (
    check &&
    JSON.stringify(expected) !==
      JSON.stringify(
        JSON.parse(await readAsset(`public/generated/ink/${layout.asset}/manifest.json`, 'utf8')),
      )
  )
    throw new Error('stale ground proof');
}
await write(
  'staging/ink/graveyard-ground-proof-receipt.json',
  JSON.stringify(
    {
      recipe: 'blackwood-ground-v2',
      inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b))),
      compositionHash: hash(
        JSON.stringify({
          paths: graveyardArt.paths,
          graves: graveyardArt.graves,
          decals: graveyardArt.decals,
          clearing,
          pavingIslands,
        }),
      ),
      layout,
      density,
      originalSourcesPreserved: true,
      runtimeSamplerSize: 1024,
    },
    null,
    2,
  ) + '\n',
);
