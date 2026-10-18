import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import sharp, { type OverlayOptions } from 'sharp';
import { runCli } from '../cli';
import { onAsyncExit } from '../scope-exit';
import { acquireCommandLane } from '../command-lane';
import { runProcess } from '../run-process';
import { hash } from '../compiler';
import { AssetCache } from './cache';
import { discoverLibrary } from './discovery';
import { projectRoot, sourceLibrary } from './paths';
import { readLibrarySource } from './sources';
import {
  LibraryScaleSchema,
  enemyScaleAssets,
  libraryFrameScales,
  nativeDrawingKey,
  scaleClips,
  scaleSourceIdentity,
  type ScaleAsset,
  type LibraryScaleRecipe,
} from './library-scale';
import recipe from '../../authoring/actor-scale.json';

type ReviewFrame = {
  key: string;
  image: string;
  canvas: number[];
  anchor: number[];
  density: number;
  rect: number[];
  trim: number[];
  visualOffsetPx: number[];
  scale: number;
};
type ReviewAsset = {
  id: string;
  label: string;
  baseline: string;
  notes: string;
  clips: {
    id: string;
    heading: string;
    frames: ReviewFrame[];
    durationsMs: number[];
    loop: boolean;
  }[];
};

// This exports comparisons, never source edits or guessed corrections. All views
// share a fixed world density; bounding boxes determine framing only.
export async function exportScaleReview(
  assets: readonly ScaleAsset[],
  output: string,
  environment: NodeJS.ProcessEnv,
  selected: readonly string[] = [],
) {
  const enemies = enemyScaleAssets(assets);
  for (const id of selected)
    if (!enemies.some((asset) => asset.id === id)) throw new Error('Unknown enemy: ' + id);
  const targets = enemies.filter((asset) => !selected.length || selected.includes(asset.id));
  const images = new Map<string, Buffer>();
  const review: ReviewAsset[] = [];
  const calibration = LibraryScaleSchema.parse(recipe);
  const draft: LibraryScaleRecipe = { schemaVersion: 1, assets: {} };
  await fs.mkdir(path.join(output, 'images'), { recursive: true });
  for (const asset of targets) {
    if (
      !/^[a-z0-9][a-z0-9_-]*$/.test(asset.id) ||
      scaleClips(asset).some(
        (clip) =>
          !/^[a-z0-9][a-z0-9_-]*$/.test(clip.id) ||
          !/^d(?:00|45|90|135|180|225|270|315)$/.test(clip.heading),
      )
    )
      throw new Error('Invalid scale review asset/clip identity');
    const identity = scaleSourceIdentity(asset);
    const current = calibration.assets[asset.id];
    const accepted = current?.sourceSha256 === identity;
    const scales = accepted ? libraryFrameScales(asset, calibration) : undefined;
    draft.assets[asset.id] = accepted
      ? current!
      : {
          sourceSha256: identity,
          baseline:
            'UNREVIEWED: choose the native idle or neutral movement pose; retain this enemy size.',
          notes: 'UNREVIEWED: inspect every drawing, facing, loop seam and action join.',
          clips: Object.fromEntries(scaleClips(asset).map((c) => [`${c.id}:${c.heading}`, 1])),
          frames: {},
        };
    const entry: ReviewAsset = {
      id: asset.id,
      label: asset.label,
      baseline: draft.assets[asset.id]!.baseline,
      notes: draft.assets[asset.id]!.notes,
      clips: [],
    };
    for (const [id, directions] of Object.entries(asset.clips))
      for (const [heading, clip] of Object.entries(directions)) {
        if (!clip) continue;
        const frames: ReviewFrame[] = [];
        for (const input of clip.frames) {
          const key = nativeDrawingKey(input);
          const sha256 = input.sourceSha256!;
          let bytes = images.get(sha256);
          if (!bytes) {
            bytes = await readLibrarySource(input.member, input.group, {
              root: sourceLibrary(environment),
              indexPath:
                input.indexPath ??
                environment.LANTERN_LIBRARY_INDEX ??
                path.join(projectRoot, 'assets/sources.json'),
            });
            if (hash(bytes) !== sha256)
              throw new Error('Changed scale review source: ' + input.member);
            images.set(sha256, bytes);
            await fs.writeFile(path.join(output, 'images', sha256 + '.png'), bytes);
          }
          const metadata = await sharp(bytes).metadata();
          frames.push({
            key,
            image: `images/${sha256}.png`,
            canvas: input.canvas,
            anchor: input.anchor,
            density: input.density,
            rect: input.rect ?? [0, 0, metadata.width!, metadata.height!],
            trim: input.trim ?? [0, 0, ...input.canvas],
            visualOffsetPx: input.visualOffsetPx ?? [0, 0],
            scale: scales?.get(key) ?? 1,
          });
        }
        entry.clips.push({ id, heading, frames, durationsMs: clip.durationsMs, loop: clip.loop });
      }
    review.push(entry);
    await writeSheets(entry, images, output);
    console.log(
      `Scale review: ${asset.id}, ${entry.clips.length} clips/facings (${accepted ? 'current review' : 'needs review'}).`,
    );
  }
  await fs.writeFile(path.join(output, 'recipe-draft.json'), JSON.stringify(draft, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'review.json'), JSON.stringify(review) + '\n');
  const template = await fs.readFile(
    path.join(projectRoot, 'tools/assets/scale-review.html'),
    'utf8',
  );
  await fs.writeFile(
    path.join(output, 'index.html'),
    template.replace('/* REVIEW_DATA */ []', () =>
      JSON.stringify(review).replaceAll('<', '\\u003c'),
    ),
  );
  return {
    assets: review.length,
    clips: review.reduce((n, a) => n + a.clips.length, 0),
    drawings: images.size,
    output,
  };
}

async function writeSheets(asset: ReviewAsset, images: Map<string, Buffer>, output: string) {
  const ppu = 96;
  const reference =
    asset.clips.find((c) => c.id === 'idle') ??
    asset.clips.find((c) => ['move', 'hover'].includes(c.id)) ??
    asset.clips[0]!;
  const crops = new Map<string, { x: number; y: number; w: number; h: number; bytes: Buffer }>();
  for (const frame of asset.clips.flatMap((c) => c.frames)) {
    if (crops.has(frame.key)) continue;
    const bytes = images.get(frame.image.slice(7, -4))!;
    const [left, top, width, height] = frame.rect as [number, number, number, number];
    const { data, info } = await sharp(bytes)
      .extract({ left, top, width, height })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let x0 = width,
      y0 = height,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * info.channels + info.channels - 1]) {
          x0 = Math.min(x0, x);
          y0 = Math.min(y0, y);
          x1 = Math.max(x1, x);
          y1 = Math.max(y1, y);
        }
    if (x1 < 0) {
      x0 = y0 = x1 = y1 = 0;
    }
    crops.set(frame.key, {
      x: x0,
      y: y0,
      w: x1 - x0 + 1,
      h: y1 - y0 + 1,
      bytes: await sharp(bytes)
        .extract({ left: left + x0, top: top + y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
        .png({ compressionLevel: 1 })
        .toBuffer(),
    });
  }
  const bounds = asset.clips
    .flatMap((c) => c.frames)
    .flatMap((f) =>
      [1, f.scale].map((scale) => {
        const crop = crops.get(f.key)!;
        const ratio = (ppu / f.density) * scale;
        return {
          x: (f.trim[0]! + crop.x - f.anchor[0]! + f.visualOffsetPx[0]!) * ratio,
          y: (f.trim[1]! + crop.y - f.anchor[1]! + f.visualOffsetPx[1]!) * ratio,
          w: crop.w * ratio,
          h: crop.h * ratio,
        };
      }),
    );
  const left = Math.floor(Math.min(...bounds.map((b) => b.x))) - 8;
  const top = Math.floor(Math.min(...bounds.map((b) => b.y))) - 8;
  const width = Math.max(190, Math.ceil(Math.max(...bounds.map((b) => b.x + b.w))) - left + 8);
  const height = Math.ceil(Math.max(...bounds.map((b) => b.y + b.h))) - top + 38;
  const raster = new Map<string, Buffer>();
  const rows: OverlayOptions[][] = [[], []];
  let overviewWidth = 0;
  for (const [clipIndex, clip] of asset.clips.entries()) {
    const composite: OverlayOptions[] = [];
    const labels: string[] = [];
    for (const [row, corrected] of [false, true].entries()) {
      for (const [column, frame] of [reference.frames[0]!, ...clip.frames].entries()) {
        const crop = crops.get(frame.key)!;
        const scale = corrected ? frame.scale : 1;
        const ratio = (ppu / frame.density) * scale;
        const key = frame.key + ':' + scale;
        if (!raster.has(key))
          raster.set(
            key,
            await sharp(crop.bytes)
              .resize(
                Math.max(1, Math.round(crop.w * ratio)),
                Math.max(1, Math.round(crop.h * ratio)),
              )
              .png({ compressionLevel: 1 })
              .toBuffer(),
          );
        composite.push({
          input: raster.get(key)!,
          left:
            column * width -
            left +
            Math.round(
              (frame.trim[0]! + crop.x - frame.anchor[0]! + frame.visualOffsetPx[0]!) * ratio,
            ),
          top:
            row * height -
            top +
            30 +
            Math.round(
              (frame.trim[1]! + crop.y - frame.anchor[1]! + frame.visualOffsetPx[1]!) * ratio,
            ),
        });
        const label = `${column ? column + ' ' + frame.key.slice(-6) : clip.id + '/' + clip.heading} ${corrected ? 'x' + frame.scale.toFixed(3) : 'supplied'}`;
        labels.push(`<text x="${column * width + 8}" y="${row * height + 20}">${label}</text>`);
      }
      const y = row * height - top + 30;
      if (y >= row * height && y < (row + 1) * height)
        labels.push(`<path d="M0 ${y}H${width * (clip.frames.length + 1)}" stroke="#857252"/>`);
    }
    const sheetWidth = width * (clip.frames.length + 1);
    overviewWidth = Math.max(overviewWidth, sheetWidth);
    composite.unshift({
      input: Buffer.from(
        `<svg width="${sheetWidth}" height="${height * 2}"><g fill="#eee" font-size="13">${labels.join('')}</g></svg>`,
      ),
      left: 0,
      top: 0,
    });
    const sheet = await sharp({
      create: { width: sheetWidth, height: height * 2, channels: 4, background: '#303039' },
    })
      .composite(composite)
      .png({ compressionLevel: 1 })
      .toBuffer();
    await fs.writeFile(path.join(output, `${asset.id}-${clip.id}-${clip.heading}.png`), sheet);
    for (const row of [0, 1])
      rows[row]!.push({
        input: await sharp(sheet)
          .extract({ left: 0, top: row * height, width: sheetWidth, height })
          .png({ compressionLevel: 1 })
          .toBuffer(),
        left: 0,
        top: clipIndex * height,
      });
  }
  for (const [row, name] of ['supplied', 'reviewed'].entries())
    await sharp({
      create: {
        width: overviewWidth,
        height: height * asset.clips.length,
        channels: 4,
        background: '#303039',
      },
    })
      .composite(rows[row]!)
      .png({ compressionLevel: 1 })
      .toFile(path.join(output, `${asset.id}-${name}.png`));
}

runCli(import.meta.url, async (args) => {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: 'string' },
      plan: { type: 'string' },
      asset: { type: 'string', multiple: true },
    },
  });
  if (!values.output)
    throw new Error('Use assets:scale-review -- --output /external/review [--asset id]');
  const output = path.resolve(values.output);
  const relative = path.relative(projectRoot, output);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
    throw new Error('Scale review output must stay outside Git');
  const lane = await acquireCommandLane({ command: 'assets:scale-review' });
  await using _lane = onAsyncExit(() => lane.release());
  await using temporary = await fs.mkdtempDisposable(path.join(os.tmpdir(), 'lantern-scale-'));
  const cache = new AssetCache();
  await cache.initialize();
  const environment = await discoverLibrary(cache, process.env);
  const plan = values.plan ?? path.join(temporary.path, 'plan.json');
  if (!values.plan)
    await runProcess('python3', ['-B', 'tools/assets/library_import.py', '--output', plan], {
      cwd: projectRoot,
      env: environment,
      idleTimeoutMs: 10 * 60_000,
    });
  const input = JSON.parse(await fs.readFile(plan, 'utf8')) as { assets: ScaleAsset[] };
  console.log(await exportScaleReview(input.assets, output, environment, values.asset));
});
