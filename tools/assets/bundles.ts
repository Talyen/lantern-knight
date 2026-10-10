import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from './files';
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
import type { PreparedAssets } from './prepare';

import { selectedFiles } from '../select-runtime-assets';
export type AssetScope = 'runtime' | 'authoring';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
export async function prepareBundles(candidate: PreparedAssets, previous?: AssetLock) {
  const inventory = await validatePack(candidate.payload, candidate.lock);
  const selection = await selectedFiles(path.join(candidate.payload, 'public'), 'runtime');
  const runtime = new Set(
    [...selection.files, ...Object.keys(selection.generated)].map((file) => 'public/' + file),
  );
  const groups = new Map<string, string[]>();
  for (const file of Object.keys(inventory.files)) {
    if (file === 'metadata/preparation-inputs.json') continue;
    const owner = runtime.has(file) || file.startsWith('metadata/') ? 'runtime' : 'authoring',
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
    // gh uploads the basename; # only supplies its display label.
    const archive = path.join(root, name + '-archive', 'lantern-assets.tar.gz');
    await fs.mkdir(path.dirname(archive), { recursive: true });
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
  scope: AssetScope = 'authoring',
) {
  const names = scope === 'runtime' && pin.bundles.runtime ? ['runtime'] : Object.keys(pin.bundles);
  const held = await cache.lease('pack-' + pin.sha256 + '-' + scope),
    parts: Awaited<ReturnType<typeof ensurePack>>[] = [];
  try {
    const files: Record<string, { sha256: string; bytes: number }> = {},
      folded = new Set<string>();
    for (const name of names) {
      const part = await ensurePack(pin.bundles[name]!, cache, request);
      parts.push(part);
      const inventory = await validateCachedPack(part.root, pin.bundles[name]!);
      for (const [file, info] of Object.entries(inventory.files)) {
        safeRelative(file);
        if (folded.has(file.toLowerCase()))
          throw new Error('Duplicate or case-colliding bundle file: ' + file);
        folded.add(file.toLowerCase());
        files[file] = info;
      }
    }
    const inventory = JSON.stringify({
      schemaVersion: 1,
      recipeSha256: pin.recipeSha256,
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    });
    const assembly = {
      ...pin,
      schemaVersion: 1 as const,
      inventorySha256: createHash('sha256').update(inventory).digest('hex'),
    };
    await installMutex(held.root, async () => {
      try {
        await validateCachedPack(held.root, assembly);
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
      try {
        for (const part of parts) {
          const data = JSON.parse(await fs.readFile(path.join(part.root, 'pack.json'), 'utf8'));
          for (const file of Object.keys(data.files)) {
            const target = path.join(incoming, file);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.link(path.join(part.root, file), target);
          }
        }
        await fs.mkdir(path.join(incoming, 'metadata'), { recursive: true });
        await fs.writeFile(path.join(incoming, 'pack.json'), inventory);
        await validatePack(incoming, assembly);
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
