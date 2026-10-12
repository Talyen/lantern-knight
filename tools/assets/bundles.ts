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
  installMatchingPreparation,
  preparationPin,
  recipeInputs,
  type AssetLock,
} from './pack';
import { makeArchive } from './archive';
import { shaFile } from './sources';
import { verifiedOutput } from '../verified-files';
import { AssetCache } from './cache';
import { diskBytes } from './cache';
import type { PreparedAssets } from './prepare';

import { selectedFiles } from '../select-runtime-assets';
export type AssetScope = 'runtime' | 'authoring';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
export async function prepareBundles(candidate: PreparedAssets, previous?: AssetLock) {
  const inventory = await validateCachedPack(candidate.payload, candidate.lock);
  const selection = await selectedFiles(path.join(candidate.payload, 'public'), 'runtime');
  const runtime = new Set(
    [...selection.files, ...Object.keys(selection.generated)].map((file) => 'public/' + file),
  );
  const groups = new Map<string, string[]>();
  for (const file of Object.keys(inventory.files)) {
    if (file === 'metadata/preparation-inputs.json') continue;
    const owner =
        runtime.has(file) || file.startsWith('metadata/')
          ? 'runtime'
          : file.endsWith('.json') || file.endsWith('/preview.png')
            ? 'bootstrap'
            : 'authoring',
      names = groups.get(owner) ?? [];
    names.push(file);
    groups.set(owner, names);
  }
  // Authoring downloads are independent parts; source eligibility is unrelated
  // to the release host's per-file transport limit.
  const authoring = groups.get('authoring') ?? [];
  groups.delete('authoring');
  for (const [name, files] of authoringGroups(authoring, inventory.files)) groups.set(name, files);
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
    const archive = path.join(root, name + '-archive', 'lantern-assets.tar.gz');
    const receiptFile = path.join(root, name + '-archive', 'lock.json');
    try {
      const parsed = LockSchema.safeParse(JSON.parse(await fs.readFile(receiptFile, 'utf8')));
      const cached = parsed.success ? parsed.data : undefined;
      if (
        cached?.schemaVersion === 1 &&
        cached.recipeSha256 === key &&
        (await fs.stat(archive)).size === cached.bytes &&
        (await shaFile(archive)) === cached.sha256
      ) {
        bundles[name] = cached;
        archives[name] = archive;
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error;
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
    await fs.mkdir(path.dirname(archive), { recursive: true });
    const lock = await makeArchive(payload, archive, key, inventory.files);
    await fs.writeFile(receiptFile, JSON.stringify(lock));
    bundles[name] = lock;
    archives[name] = archive;
    await fs.rm(payload, { recursive: true, force: true });
  }
  const accepted = preparationPin(candidate.lock, await recipeInputs(), inventory);
  const pin = LockSchema.parse({ ...accepted, schemaVersion: 3, bundles }) as BundlePin;
  await fs.writeFile(path.join(root, 'plan.json'), JSON.stringify({ pin, archives }));
  return { pin, archives };
}
// Hash-prefix partitions keep deletions and additions local to one shard.
// Oversized shards split further; neighboring bundles never shift boundaries.
export function authoringGroups(
  files: string[],
  inventory: Record<string, { bytes: number }>,
  limit = 1024 ** 3,
) {
  const groups = new Map<string, string[]>();
  const partition = (names: string[], prefix: string, depth: number) => {
    if (!names.length) return;
    if (
      names.length === 1 ||
      names.reduce((sum, file) => sum + inventory[file]!.bytes, 0) <= limit
    ) {
      groups.set('authoring-' + prefix, names.sort());
      return;
    }
    if (depth >= 64) throw new Error('Cannot partition authoring bundle');
    const buckets = new Map<string, string[]>();
    for (const file of names) {
      const key = createHash('sha256').update(file).digest('hex')[depth]!;
      const bucket = buckets.get(key) ?? [];
      bucket.push(file);
      buckets.set(key, bucket);
    }
    for (const [key, bucket] of buckets) partition(bucket, prefix + key, depth + 1);
  };
  // A fixed first partition avoids reshuffling the whole library when it grows.
  const buckets = new Map<string, string[]>();
  for (const file of files) {
    const key = (createHash('sha256').update(file).digest()[0]! % 64).toString(16).padStart(2, '0');
    const bucket = buckets.get(key) ?? [];
    bucket.push(file);
    buckets.set(key, bucket);
  }
  for (const [key, bucket] of buckets) partition(bucket, key, 2);
  return groups;
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
    if (scope === 'authoring') {
      try {
        const inventory = await fs.readFile(path.join(held.root, 'pack.json'));
        // The complete authoring assembly has the pin's payload identity even
        // though its inventory serialization differs from the original archive.
        // Verify that identity and every file before acquiring redundant bundles.
        await validateCachedPack(held.root, {
          ...pin,
          schemaVersion: 2,
          inventorySha256: createHash('sha256').update(inventory).digest('hex'),
        });
        return held;
      } catch {
        // Missing or corrupt assemblies still rebuild from verified bundles.
      }
      if (await installMatchingPreparation(held, pin, cache)) return held;
    }
    const files: Record<string, { sha256: string; bytes: number }> = {},
      folded = new Set<string>();
    const acquired = new Map<string, Awaited<ReturnType<typeof ensurePack>>>();
    let next = 0;
    let failure: unknown;
    await Promise.all(
      Array.from({ length: Math.min(2, names.length) }, async () => {
        while (!failure && next < names.length) {
          const name = names[next++]!;
          try {
            const part = await ensurePack(pin.bundles[name]!, cache, request);
            parts.push(part);
            acquired.set(name, part);
          } catch (error) {
            failure = error;
          }
        }
      }),
    );
    if (failure) throw failure;
    for (const name of names) {
      const part = acquired.get(name)!;
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
        await verifiedOutput(
          held.root,
          [...Object.keys(files), 'pack.json'],
          async () => {},
          '.verified-pack.json',
        );
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
