import { projectRoot, stagingRoot, publicFile, assetFile } from './assets/paths';
import { readLibrarySource, sourceGroup } from './assets/sources';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { parseSource, parseManifest, type Manifest } from '../src/assets/schema';
import contract from '../src/assets/camera.json';
import { cameraCalibration as calibrationFixture } from '../src/assets/camera-calibration';
const root = projectRoot;
export const TOOL_VERSION = 'atlas-v2.2-sharp-0.35.5';
export const hash = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
export async function exactSource(relative: string, base = stagingRoot()) {
  if (base.startsWith('references/art/')) return readLibrarySource(relative, sourceGroup(base));
  base = assetFile(base);
  const parts = relative.split('/');
  let current = base;
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.includes('\\'))
      throw new Error(`unsafe source path: ${relative}`);
    const names = await fs.readdir(current);
    if (!names.includes(part)) throw new Error(`exact filename case or missing file: ${relative}`);
    current = path.join(current, part);
  }
  const real = await fs.realpath(current),
    baseReal = await fs.realpath(base);
  if (!real.startsWith(baseReal + path.sep))
    throw new Error(`source escapes approved root: ${relative}`);
  return fs.readFile(current);
}
// Dilate RGB into transparent pixels, then extrude the trim edge. Straight alpha stays unchanged.
export function paddedPixels(raw: Buffer, w: number, h: number, pad = 4) {
  const dilated = Buffer.from(raw);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dst = (y * w + x) * 4;
      if (raw[dst + 3]) continue;
      let found = false;
      for (let radius = 1; radius <= 3 && !found; radius++)
        for (let dy = -radius; dy <= radius && !found; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
            const src = (yy * w + xx) * 4;
            if (raw[src + 3]! > 0) {
              raw.copy(dilated, dst, src, src + 3);
              found = true;
              break;
            }
          }
    }
  const width = w + pad * 2,
    height = h + pad * 2,
    result = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const xx = Math.min(w - 1, Math.max(0, x - pad)),
        yy = Math.min(h - 1, Math.max(0, y - pad));
      const src = (yy * w + xx) * 4,
        dst = (y * width + x) * 4;
      dilated.copy(result, dst, src, src + 4);
      if (x < pad - 2 || x >= width - pad + 2 || y < pad - 2 || y >= height - pad + 2)
        result[dst + 3] = 0;
    }
  return { data: result, width, height };
}
export async function compile(
  sourceFile = 'source.json',
  out = publicFile('generated'),
  production = false,
  validateOnly = false,
  inputRoot = stagingRoot(),
) {
  out = assetFile(out);
  const input = await exactSource(sourceFile, inputRoot),
    source = parseSource(JSON.parse(input.toString()), production);
  if (production) {
    const canonical = await fs.readFile(path.join(root, 'references/canon/image(3).png'));
    if (hash(canonical) !== source.asset.canonicalReferenceHash)
      throw new Error('canonical reference bytes changed: image(3).png must remain unchanged');
  }
  const frames = [] as Manifest['frames'],
    size = source.asset.atlasSize ?? contract.atlasSize,
    pad = source.asset.type === 'material' ? 0 : 4;
  const pages: { raw: Buffer; id: string }[] = [];
  let x = 0,
    y = 0,
    row = 0,
    index = -1;
  const digest = createHash('sha256')
    .update(input)
    .update(TOOL_VERSION)
    .update(JSON.stringify(contract));
  for (const f of source.frames) {
    const registration = f.registration ?? source.asset;
    const file = await exactSource(f.path, inputRoot);
    digest.update(file);
    const metadata = await sharp(file).metadata();
    if (
      metadata.format !== 'png' ||
      !metadata.hasAlpha ||
      metadata.depth !== 'uchar' ||
      metadata.space !== 'srgb'
    )
      throw new Error(`${f.path}: reviewed RGBA8 sRGB PNG with alpha required`);
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== registration.canvas[0] || info.height !== registration.canvas[1])
      throw new Error(`${f.path}: dimensions ${info.width}x${info.height} differ from canvas`);
    let minX = info.width,
      minY = info.height,
      maxX = -1,
      maxY = -1;
    for (let yy = 0; yy < info.height; yy++)
      for (let xx = 0; xx < info.width; xx++)
        if (data[(yy * info.width + xx) * 4 + 3]! > (f.origin === 'imported-study' ? 0 : 1)) {
          minX = Math.min(minX, xx);
          minY = Math.min(minY, yy);
          maxX = Math.max(maxX, xx);
          maxY = Math.max(maxY, yy);
        }
    if (maxX < 0) {
      if (!source.asset.allowEmptyFrames) throw new Error(`${f.path}: empty frame`);
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
    // One transparent source pixel around the silhouette preserves soft-edge filtering.
    minX = Math.max(0, minX - 1);
    minY = Math.max(0, minY - 1);
    maxX = Math.min(info.width - 1, maxX + 1);
    maxY = Math.min(info.height - 1, maxY + 1);
    const w = maxX - minX + 1,
      h = maxY - minY + 1;
    if (w + pad * 2 > size || h + pad * 2 > size)
      throw new Error(`${f.path}: frame exceeds atlas page`);
    const trimmed = await sharp(data, { raw: info })
      .extract({ left: minX, top: minY, width: w, height: h })
      .raw()
      .toBuffer();
    const padded = pad ? paddedPixels(trimmed, w, h, pad) : { data: trimmed, width: w, height: h };
    if (x + padded.width > size) {
      x = 0;
      y += row;
      row = 0;
    }
    if (index < 0 || y + padded.height > size) {
      index++;
      pages.push({ id: `atlas-${index}`, raw: Buffer.alloc(size * size * 4) });
      x = 0;
      y = 0;
      row = 0;
    }
    const target = pages[index]!.raw;
    for (let yy = 0; yy < padded.height; yy++)
      padded.data.copy(
        target,
        ((y + yy) * size + x) * 4,
        yy * padded.width * 4,
        (yy + 1) * padded.width * 4,
      );
    frames.push({
      id: f.id,
      source: f.path,
      origin: f.origin,
      attachments: f.attachments,
      ...(f.visualOffsetPx ? { visualOffsetPx: f.visualOffsetPx } : {}),
      ...(f.registration ? { registration: f.registration } : {}),
      page: pages[index]!.id,
      rect: [x + pad, y + pad, w, h],
      trim: [minX, minY, w, h],
      rotated: false,
    });
    x += padded.width;
    row = Math.max(row, padded.height);
  }
  const contentHash = digest.digest('hex'),
    folder = contentHash.slice(0, 16);
  // Remove unused atlas area, never source pixels or the extrusion/gutters.
  // Registration stays in the original canvas; UVs use each published page size.
  const dimensions = pages.map((p) => {
    if (!source.frames.every((f) => f.origin === 'imported-study'))
      return { width: size, height: size };
    const used = frames.filter((f) => f.page === p.id),
      round = (n: number) => Math.min(size, Math.ceil(n / 64) * 64);
    return {
      width: round(Math.max(...used.map((f) => f.rect[0] + f.rect[2] + pad))),
      height: round(Math.max(...used.map((f) => f.rect[1] + f.rect[3] + pad))),
    };
  });
  const encoded = await Promise.all(
    pages.map((p, i) =>
      sharp(p.raw, { raw: { width: size, height: size, channels: 4 } })
        .extract({ left: 0, top: 0, ...dimensions[i]! })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );
  const manifest: Manifest = {
    schemaVersion: 2,
    contractId: contract.id,
    bakeVersion: contract.bakeVersion,
    hash: contentHash,
    toolVersion: TOOL_VERSION,
    asset: source.asset,
    frames,
    pages: pages.map((p, i) => ({
      id: p.id,
      path: `${folder}/${p.id}.png`,
      hash: hash(encoded[i]!),
      ...dimensions[i]!,
      bytes: encoded[i]!.length,
      rgbaBytes: dimensions[i]!.width * dimensions[i]!.height * 4,
      extrusion: pad ? 2 : 0,
      gutter: pad ? 2 : 0,
      mipmaps: source.asset.sampling === 'terrain-mipmapped',
    })),
    bundles: {
      boot: { required: [], optional: [], dependencies: [] },
      hero: { required: pages.map((p) => p.id), optional: [], dependencies: ['boot'] },
      room: { required: pages.map((p) => p.id), optional: [], dependencies: ['hero'] },
    },
  };
  parseManifest(manifest, production);
  if (validateOnly) return manifest;
  await fs.mkdir(out, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(out, '.compile-'));
  try {
    await Promise.all(
      encoded.map((buf, i) => fs.writeFile(path.join(tmp, `${pages[i]!.id}.png`), buf)),
    );
    await fs.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    try {
      await fs.rename(tmp, path.join(out, folder));
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' &&
        (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY'
      )
        throw error;
      await fs.rm(tmp, { recursive: true, force: true });
    }
    await fs.writeFile(
      path.join(out, 'manifest.json.tmp'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    await fs.rename(path.join(out, 'manifest.json.tmp'), path.join(out, 'manifest.json'));
    await fs.writeFile(
      path.join(out, 'calibration.json'),
      JSON.stringify(calibrationFixture(), null, 2) + '\n',
    );
    await fs.writeFile(
      path.join(out, 'report.json'),
      JSON.stringify(
        {
          hash: contentHash,
          toolVersion: TOOL_VERSION,
          frames: frames.length,
          pages: pages.length,
          fileBytes: manifest.pages.reduce((s, p) => s + p.bytes, 0),
          baseGpuBytes: manifest.pages.reduce((s, p) => s + p.rgbaBytes, 0),
          occupancy:
            frames.reduce((s, f) => s + f.rect[2] * f.rect[3], 0) /
            manifest.pages.reduce((s, p) => s + p.width * p.height, 0),
          status: source.asset.status,
        },
        null,
        2,
      ),
    );
    return manifest;
  } catch (error) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw error;
  }
}
if (process.argv[1]?.endsWith('compiler.ts'))
  compile(
    'source.json',
    publicFile('generated'),
    process.argv.includes('--production'),
    process.argv.includes('--validate'),
  )
    .then((m) =>
      console.log(
        `Asset ${m.asset.id}: ${m.frames.length} frames, ${m.pages.length} pages; ${m.hash}`,
      ),
    )
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
