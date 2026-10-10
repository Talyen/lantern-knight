import type { BuildProfile } from './build-profile';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from './assets/files';
import { parseManifest } from '../src/assets/schema';
import { playgroundCatalog } from '../src/content/effects-playground-assets';
import { loadingVideoPath } from '../src/content/loading-media';
import { readAuthoringCatalog } from './assets/authoring-catalog';
import { assetCatalog } from '../src/content/asset-catalog';

export type SelectedFiles = { files: string[]; generated: Record<string, string>; bytes: number };
export async function selectedFiles(
  publicRoot: string,
  profile: BuildProfile | 'runtime' = 'game',
): Promise<SelectedFiles> {
  const dev = profile === 'authoring';
  const catalog = dev
    ? { ...(await readAuthoringCatalog(publicRoot)), ...playgroundCatalog }
    : profile === 'runtime'
      ? assetCatalog
      : (await import('../src/content/game-content')).gameAssetCatalog;
  const files = new Set([
    'build-mode.json',
    'generated/calibration.json',
    'registration.json',
    'animation/flow.png',
    loadingVideoPath,
  ]);
  const generated: Record<string, string> = {};
  const read = (name: string) => fs.readFile(path.join(publicRoot, safeRelative(name)));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const manifests = new Map();
  for (const [id, file] of Object.entries(catalog)) {
    const m = parseManifest(JSON.parse((await read(file)).toString()));
    if (m.asset.id !== id) throw new Error('Manifest identity differs: ' + id);
    manifests.set(id, m);
    files.add(file);
    for (const page of m.pages) {
      const name = path.posix.join(path.posix.dirname(file), page.path);
      if (hash(await read(name)) !== page.hash) throw new Error('Prepared page differs: ' + name);
      files.add(name);
    }
  }
  const lighting = JSON.parse((await read('lighting/manifest.json')).toString());
  lighting.entries = Object.fromEntries(
    Object.entries(
      lighting.entries as Record<
        string,
        { file: string; hash: string; sourceHash: string; rect: unknown; trim: unknown }
      >,
    ).filter(([key]) => key.split(':')[0]! in catalog),
  );
  for (const [key, e] of Object.entries(lighting.entries) as [
    string,
    { file: string; hash: string; sourceHash: string; rect: unknown; trim: unknown },
  ][]) {
    const id = key.slice(0, key.indexOf(':')),
      frameId = key.slice(key.indexOf(':') + 1),
      m = manifests.get(id)!;
    const frame = m.frames.find((f: { id: string }) => f.id === frameId);
    if (
      !frame ||
      m.pages.find((p: { id: string; hash: string }) => p.id === frame.page)?.hash !==
        e.sourceHash ||
      JSON.stringify(frame.rect) !== JSON.stringify(e.rect) ||
      JSON.stringify(frame.trim) !== JSON.stringify(e.trim)
    )
      throw new Error('Lighting registration differs: ' + key);
    const file = 'lighting/' + safeRelative(e.file);
    if (hash(await read(file)) !== e.hash) throw new Error('Lighting companion differs: ' + file);
    files.add(file);
  }
  generated['lighting/manifest.json'] = JSON.stringify(lighting) + '\n';
  const surfaces = JSON.parse((await read('visual-effects/surfaces.json')).toString());
  surfaces.entries = Object.fromEntries(
    Object.entries(surfaces.entries as Record<string, { asset: string }>).filter(
      ([, entry]) => entry.asset in catalog,
    ),
  );
  generated['visual-effects/surfaces.json'] = JSON.stringify(surfaces) + '\n';
  for (const entry of Object.values(surfaces.entries) as { file: string; hash: string }[]) {
    const file = 'visual-effects/' + safeRelative(entry.file);
    if (hash(await read(file)) !== entry.hash)
      throw new Error('Surface companion differs: ' + file);
    files.add(file);
  }
  if (dev) files.add('dev-effects/emitters.json');
  const libraryEntries = Object.fromEntries(
    Object.entries(catalog).filter(([id]) => id.startsWith('library-')),
  );
  if (dev || Object.keys(libraryEntries).length)
    generated['generated/library/catalog.json'] = JSON.stringify(libraryEntries) + '\n';
  const sorted = [...files].sort();
  let bytes = 0;
  for (const file of sorted) bytes += (await fs.stat(path.join(publicRoot, file))).size;
  bytes += Object.values(generated).reduce((n, text) => n + Buffer.byteLength(text), 0);
  return { files: sorted, generated, bytes };
}
export async function copySelectedFiles(
  source: string,
  destination: string,
  inventory: SelectedFiles,
) {
  for (const file of inventory.files) {
    const target = path.join(destination, safeRelative(file));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(source, file), target);
  }
  for (const [file, text] of Object.entries(inventory.generated)) {
    const target = path.join(destination, safeRelative(file));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }
}
