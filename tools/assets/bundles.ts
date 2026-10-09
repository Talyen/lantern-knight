import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  LockSchema,
  validatePack,
  validateCachedPack,
  ensurePack,
  installMutex,
  preparationPin,
  recipeInputs,
  type AssetLock,
} from './pack';
import { makeArchive } from './archive';
import { AssetCache } from './cache';
import { diskBytes } from './cache';
import type { PreparedAssets } from './publication';
import { safeRelative } from './paths';
import { worldVisuals, sceneAssets } from '../../src/content/world-art';
import { assetCatalog } from '../../src/content/asset-catalog';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
export function bundleOwner(file: string) {
  if (file.startsWith('public/media/'))
    return (
      'media-' +
      path.posix
        .basename(file)
        .replace(/\.[^.]*$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_')
    );
  if (file.startsWith('public/generated/library/') || file.startsWith('metadata/library/'))
    return 'developer';
  if (
    /^(?:public\/animation\/|public\/generated\/ink\/ink-hero|metadata\/(?:ink\/hero|rest\/))/.test(
      file,
    )
  )
    return 'hero';
  const owners = Object.entries(worldVisuals)
    .filter(([, art]) =>
      sceneAssets(art).some((id) => {
        const manifest = assetCatalog[id];
        return manifest && file.startsWith('public/' + path.posix.dirname(manifest) + '/');
      }),
    )
    .map(([id]) => id);
  return owners.length === 1 ? 'room-' + owners[0] : 'common';
}
export async function prepareBundles(candidate: PreparedAssets, previous?: AssetLock) {
  const inventory = await validatePack(candidate.payload, candidate.lock);
  const groups = new Map<string, string[]>();
  for (const file of Object.keys(inventory.files)) {
    const owner = bundleOwner(file),
      names = groups.get(owner) ?? [];
    names.push(file);
    groups.set(owner, names);
  }
  const bundles: BundlePin['bundles'] = {},
    archives: Record<string, string> = {};
  const root = path.join(candidate.held.root, 'bundles');
  await fs.mkdir(root, { recursive: true });
  for (const [name, files] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const key = createHash('sha256')
      .update(JSON.stringify(files.sort().map((file) => [file, inventory.files[file]])))
      .digest('hex');
    const prior = previous?.schemaVersion === 3 ? previous.bundles[name] : undefined;
    if (prior?.recipeSha256 === key) {
      bundles[name] = prior;
      continue;
    }
    const payload = path.join(root, name);
    if (candidate.held.reserve)
      await candidate.held.reserve(
        (await diskBytes(candidate.held.root)) +
          files.reduce((bytes, file) => bytes + inventory.files[file]!.bytes, 0) +
          4096,
      );
    await fs.rm(payload, { recursive: true, force: true });
    for (const file of files) {
      safeRelative(file);
      const target = path.join(payload, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.link(path.join(candidate.payload, file), target);
    }
    const archive = path.join(root, name + '.tar.gz');
    const lock = await makeArchive(payload, archive, key);
    bundles[name] = lock;
    archives[name] = archive;
    await fs.rm(payload, { recursive: true, force: true });
  }
  const accepted = preparationPin(candidate.lock, await recipeInputs(), inventory);
  const pin = LockSchema.parse({ ...accepted, schemaVersion: 3, bundles }) as BundlePin;
  await fs.writeFile(path.join(root, 'plan.json'), JSON.stringify({ pin, archives }));
  return { pin, archives };
}
export async function ensureBundlePack(
  pin: BundlePin,
  cache = new AssetCache(),
  request: typeof fetch = fetch,
) {
  const held = await cache.lease('pack-' + pin.sha256),
    parts: Awaited<ReturnType<typeof ensurePack>>[] = [];
  try {
    await installMutex(held.root, async () => {
      try {
        await validateCachedPack(held.root, pin);
        return;
      } catch {}
      const exists = await fs.access(path.join(held.root, 'pack.json')).then(
        () => true,
        () => false,
      );
      if (exists && !(await held.sole()))
        throw new Error('Bundle assembly is in use; stop its readers before repairing it');
      const incoming = path.join(held.root, '.bundle-incoming');
      await fs.rm(incoming, { recursive: true, force: true });
      const files: Record<string, { sha256: string; bytes: number }> = {};
      const folded = new Set<string>();
      try {
        for (const bundle of Object.values(pin.bundles)) {
          const part = await ensurePack(bundle, cache, request);
          parts.push(part);
          const inventory = await validateCachedPack(part.root, bundle);
          for (const [file, info] of Object.entries(inventory.files)) {
            safeRelative(file);
            if (folded.has(file.toLowerCase()))
              throw new Error('Duplicate or case-colliding file across asset bundles: ' + file);
            folded.add(file.toLowerCase());
            files[file] = info;
            const target = path.join(incoming, file);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.link(path.join(part.root, file), target);
          }
        }
        const sorted = Object.fromEntries(
          Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
        await fs.writeFile(
          path.join(incoming, 'pack.json'),
          JSON.stringify({ schemaVersion: 1, recipeSha256: pin.recipeSha256, files: sorted }),
        );
        await validatePack(incoming, pin);
        for (const name of ['public', 'metadata', 'pack.json']) {
          await fs.rm(path.join(held.root, name), { recursive: true, force: true });
          await fs.rename(path.join(incoming, name), path.join(held.root, name));
        }
      } finally {
        await fs.rm(incoming, { recursive: true, force: true });
      }
    });
    return held;
  } catch (error) {
    await held.release();
    throw error;
  } finally {
    for (const part of parts) await part.release();
  }
}
