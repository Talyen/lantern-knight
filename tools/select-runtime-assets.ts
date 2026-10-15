import { audioManifestPath } from '../src/assets/audio';
import { readPreparedAudio } from './assets/prepared-audio';
import type { BuildProfile } from './build-profile';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from './assets/files';
import { parseManifest, type Manifest } from '../src/assets/schema';
import { playgroundCatalog } from '../src/content/effects-playground-assets';
import { loadingVideoPath } from '../src/content/loading-media';
import { readAuthoringCatalog } from './assets/authoring-catalog';
import { assetCatalog } from '../src/content/asset-catalog';
import { gameRegistration, runtimeBundles } from './build-runtime-delivery';

export type SelectedFiles = {
  files: string[];
  generated: Record<string, string>;
  binary?: Record<string, Buffer>;
  bytes: number;
};
export async function selectedFiles(
  publicRoot: string,
  profile: BuildProfile | 'runtime' = 'game',
  ensureFile?: (relative: string) => Promise<boolean>,
): Promise<SelectedFiles> {
  const dev = profile === 'authoring';
  const catalog = dev
    ? { ...(await readAuthoringCatalog(publicRoot)), ...playgroundCatalog }
    : profile === 'runtime'
      ? { ...assetCatalog, ...(await import('../src/content/game-content')).gameAssetCatalog }
      : (await import('../src/content/game-content')).gameAssetCatalog;
  const files = new Set([
    'build-mode.json',
    'generated/calibration.json',
    'registration.json',
    'animation/flow.png',
    loadingVideoPath,
  ]);
  const generated: Record<string, string> = {};
  const groups = new Map<string, Set<string>>();
  const bundleFile = (id: string, file: string) => {
    if (profile !== 'game') return;
    const files = groups.get(id) ?? new Set<string>();
    files.add(file);
    groups.set(id, files);
  };
  const read = async (name: string) => {
    safeRelative(name);
    await ensureFile?.(name);
    return fs.readFile(path.join(publicRoot, name));
  };
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const audio = await readPreparedAudio(read);
  generated[audioManifestPath] = JSON.stringify(audio) + '\n';
  for (const sample of audio.samples) {
    const bytes = await read(sample.path);
    if (bytes.length !== sample.bytes || hash(bytes) !== sample.hash)
      throw new Error('Prepared audio differs: ' + sample.id);
    files.add(sample.path);
  }
  const manifests = new Map();
  for (const [id, file] of Object.entries(catalog)) {
    const m = parseManifest(JSON.parse((await read(file)).toString()));
    if (m.asset.id !== id) throw new Error('Manifest identity differs: ' + id);
    manifests.set(id, m);
    files.add(file);
    for (const page of m.pages) {
      const name = path.posix.join(path.posix.dirname(file), page.path);
      if (
        dev ||
        !page.delivery?.some(
          (v) => v.encoding === 'png' && v.width === page.width && v.height === page.height,
        )
      ) {
        if (hash(await read(name)) !== page.hash) throw new Error('Prepared page differs: ' + name);
        files.add(name);
        if (page.bytes <= 512 * 1024) bundleFile(id, name);
      }
      for (const image of [
        ...(page.delivery ?? []),
        ...(dev && page.preview ? [page.preview] : []),
      ]) {
        if (hash(await read(image.path)) !== image.hash)
          throw new Error('Prepared delivery image differs: ' + image.path);
        files.add(image.path);
        if (image.encoding === 'png' && image.bytes <= 512 * 1024) bundleFile(id, image.path);
      }
    }
  }
  if (
    [...manifests.values()].some((m) =>
      m.pages.some((p: Manifest['pages'][number]) =>
        p.delivery?.some((v) => v.encoding === 'ktx2-uastc'),
      ),
    )
  )
    for (const name of ['basis_transcoder.js', 'basis_transcoder.wasm'])
      files.add('decoders/' + name);
  if (dev) {
    for (const file of [
      'generated/library/index.json',
      'generated/library/inventory.json',
      'generated/library/delivery-report.json',
    ])
      if (
        await fs.access(path.join(publicRoot, file)).then(
          () => true,
          () => false,
        )
      )
        files.add(file);
    try {
      const inventory = JSON.parse((await read('generated/library/inventory.json')).toString());
      for (const media of inventory.media ?? []) files.add(safeRelative(media.file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
    bundleFile(id, file);
  }
  generated['lighting/manifest.json'] = JSON.stringify(lighting) + '\n';
  if (dev) files.add('dev-effects/emitters.json');
  const libraryEntries = Object.fromEntries(
    Object.entries(catalog).filter(([id]) => id.startsWith('library-')),
  );
  if (dev || Object.keys(libraryEntries).length)
    generated['generated/library/catalog.json'] = JSON.stringify(libraryEntries) + '\n';
  let binary: Record<string, Buffer> | undefined;
  if (profile === 'game') {
    const projection = gameRegistration(
      await read('registration.json'),
      await read('build-mode.json'),
      Object.keys(catalog),
    );
    generated['registration.json'] = projection.registration;
    const delivery = await runtimeBundles(groups, read);
    binary = delivery.binary;
    generated['build-mode.json'] = JSON.stringify({
      ...projection.policy,
      assetBundles: delivery.bundles,
    });
    generated['game-build-mode.json'] = generated['build-mode.json']!;
    files.delete('registration.json');
    files.delete('build-mode.json');
  }
  const sorted = [...files].sort();
  let bytes = 0;
  for (const file of sorted) {
    await ensureFile?.(file);
    bytes += (await fs.stat(path.join(publicRoot, file))).size;
  }
  bytes += Object.values(generated).reduce((n, text) => n + Buffer.byteLength(text), 0);
  bytes += Object.values(binary ?? {}).reduce((n, value) => n + value.length, 0);
  return { files: sorted, generated, binary, bytes };
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
  for (const [file, bytes] of Object.entries(inventory.binary ?? {})) {
    const target = path.join(destination, safeRelative(file));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
}
