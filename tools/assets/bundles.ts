import { onAsyncExit } from '../scope-exit';
import { readJson } from '../json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from './files';
import {
  validatePack,
  validateCachedPack,
  ensurePack,
  installMutex,
  installMatchingPreparation,
  type AssetLock,
} from './pack';
import { verifiedOutput } from '../verified-files';
import { AssetCache } from './cache';

export type AssetScope = 'runtime' | 'authoring';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
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
  const held = await cache.lease('pack-' + pin.sha256 + '-' + scope, 0, false, true),
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
      await using _cleanup1 = onAsyncExit(() => fs.rm(incoming, { recursive: true, force: true }));
      for (const part of parts) {
        const data = await readJson(path.join(part.root, 'pack.json'));
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
    });
    return held;
  } catch (error) {
    await held.release();
    throw error;
  } finally {
    for (const part of parts) await part.release();
  }
}
