import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';

import type { Manifest } from '../../../src/assets/schema';
import { normalPixels } from '../../../src/assets/normal-pixels';
import { readAuthoringCatalog } from '../authoring-catalog';
import { needsLighting } from '../../lighting-bindings';
import type { PreparationContext } from '../context';
export async function prepare(context: PreparationContext, check = false) {
  const { readAsset } = context;

  const root = 'public/lighting',
    recipe = 'alpha-volume-v1',
    sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
  // Retain authored-input parsing: malformed artwork recipes must still fail preparation.
  JSON.parse(await readAsset('authoring/graveyard-art.json', 'utf8'));
  const entries: Record<string, unknown> = {};
  const write = check ? undefined : context.writeAsset;
  async function output(file: string, bytes: Buffer | string) {
    if (check) {
      if (!Buffer.from(bytes).equals(await readAsset(file)))
        throw new Error(`lighting derivative stale: ${file}`);
    } else {
      await write!(file, bytes);
    }
  }
  const catalog = await readAuthoringCatalog(context.publicDirectory);
  for (const asset of Object.keys(catalog)) {
    const manifest = JSON.parse(
      await readAsset(path.join('public', catalog[asset]!), 'utf8'),
    ) as Manifest;
    if (!needsLighting(asset, manifest)) continue;
    const pageBytes = new Map<string, Buffer>();
    for (const frame of manifest.frames) {
      const page = manifest.pages.find((p) => p.id === frame.page)!,
        source = path.join('public', path.dirname(catalog[asset]!), page.path),
        bytes = pageBytes.get(source) ?? (await readAsset(source));
      pageBytes.set(source, bytes);
      if (sha(bytes) !== page.hash) throw new Error(`lighting source changed: ${source}`);
      const [left, top, width, height] = frame.rect,
        scale = Math.min(1, 192 / height),
        w = Math.max(1, Math.round(width * scale)),
        h = Math.max(1, Math.round(height * scale));
      // Each frame is filtered independently: neighboring atlas frames never bleed into normals.
      const alpha = await sharp(bytes)
        .extract({ left, top, width, height })
        .resize(w, h)
        .extractChannel('alpha')
        .blur(Math.max(0.3, Math.min(w, h) * 0.045))
        .raw()
        .toBuffer();
      const normals = normalPixels(alpha, w, h, Math.max(6, Math.min(w, h) * 0.22));
      const png = await sharp(normals, { raw: { width: w, height: h, channels: 4 } })
          .png()
          .toBuffer(),
        key = sha(JSON.stringify({ recipe, page: page.hash, rect: frame.rect, trim: frame.trim })),
        file = `${key}.png`;
      await output(path.join(root, file), png);
      entries[`${asset}:${frame.id}`] = {
        file,
        hash: sha(png),
        sourceHash: page.hash,
        rect: frame.rect,
        trim: frame.trim,
        width: w,
        height: h,
      };
    }
  }
  await output(
    path.join(root, 'manifest.json'),
    JSON.stringify({ recipe, entries }, null, 2) + '\n',
  );
  console.log(
    `${check ? 'Verified' : 'Prepared'} ${Object.keys(entries).length} independent lighting companions; original art is unchanged.`,
  );
}
