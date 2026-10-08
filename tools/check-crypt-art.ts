import { readRegistration } from './assets/data';
import { readAsset } from './assets/io';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import * as T from 'three';
import { content } from '../src/content/game-content';
import { worldVisuals, areaArtAssets } from '../src/content/world-art';
import { assetCatalog } from '../src/content/visuals';
import { parseManifest } from '../src/assets/schema';
import { makeCamera } from '../src/core/camera';
import { InkRoom } from '../src/presentation/ink-room';
import {
  findDepthConflicts,
  depthConflictMask,
  validateConstruction,
  type AlphaImage,
} from '../src/presentation/art-validation';
import type { PackLease } from '../src/assets/loader';

export async function inspectCrypt() {
  const area = content.area('upper-landing'),
    art = worldVisuals[area.id]!,
    packs = new Map<string, PackLease>(),
    imagesByTexture = new Map<T.Texture, AlphaImage>();
  for (const id of areaArtAssets(area)) {
    const manifest = parseManifest(
        JSON.parse(await readAsset(`public/${assetCatalog[id]}`, 'utf8')),
      ),
      textures = new Map<string, T.Texture>();
    for (const p of manifest.pages) {
      const texture = new T.Texture(),
        raw = await sharp(
          await readAsset(path.join('public', path.dirname(assetCatalog[id]!), p.path)),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
      textures.set(p.id, texture);
      imagesByTexture.set(texture, {
        width: raw.info.width,
        height: raw.info.height,
        data: raw.data,
      });
    }
    packs.set(id, { manifest, textures, release: () => {} });
  }
  const group = new T.Group(),
    room = new InkRoom(area, packs, group, makeCamera(16 / 9), undefined, readRegistration());
  room.build();
  try {
    const meshes = [
        ...room.sprites.filter((s) => s.manifest.asset.type !== 'effect').map((s) => s.mesh),
        ...(room.architecture?.parts ?? []),
      ],
      images = new Map<T.Mesh, AlphaImage>();
    for (const m of meshes) {
      const mat = m.material as T.MeshBasicMaterial,
        im = mat.map ? imagesByTexture.get(mat.map) : undefined;
      if (im) images.set(m, im);
    }
    const result = {
      constructionErrors: validateConstruction(area, art),
      depthConflicts: findDepthConflicts(meshes, images),
      checkedParts: meshes.length,
      limits:
        'Alpha-aware coplanar checks and authored solid occupancy; dynamic motion is checked by the packaged replay.',
    };
    if (result.depthConflicts.length || result.constructionErrors.length) {
      const dir = 'tmp/crypt-art-validation';
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(`${dir}/report.json`, JSON.stringify(result, null, 2) + '\n');
      for (const [i, conflict] of result.depthConflicts.entries()) {
        const mask = depthConflictMask(conflict, meshes, images);
        await sharp(mask.data, { raw: { width: mask.width, height: mask.height, channels: 4 } })
          .png()
          .toFile(`${dir}/overlap-${i}.png`);
      }
    }
    return result;
  } finally {
    room.dispose();
    for (const p of packs.values()) for (const t of p.textures.values()) t.dispose();
  }
}
if (process.argv[1]?.endsWith('check-crypt-art.ts')) {
  const result = await inspectCrypt();
  if (process.argv.includes('--output')) {
    const output = process.argv[process.argv.indexOf('--output') + 1]!;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
  }
  if (result.constructionErrors.length || result.depthConflicts.length)
    throw new Error(JSON.stringify(result, null, 2));
  console.log(
    `PASS: ${result.checkedParts} Crypt parts; supported mounts and clear nave; no ambiguous opaque depth.`,
  );
}
