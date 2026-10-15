import { onAsyncExit } from '../scope-exit';
import { readJson } from '../json-file';
import { downloadFile } from './download';
export { recipeInputs, recipeHash } from './recipe';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import * as tar from 'tar';
import { AssetCache, diskBytes } from './cache';
import { projectRoot, CACHE_LIMIT } from './paths';
import { shaFile } from './sources';
import { verifiedOutput } from '../verified-files';

const hash = z.string().regex(/^[a-f0-9]{64}$/),
  bytes = z.number().int().nonnegative();
const FileDeliverySchema = z.strictObject({
  releaseTag: z.string().regex(/^assets-catalog-[a-f0-9]{16}$/),
  filename: z.literal('files.json.gz'),
  sha256: hash,
  bytes: bytes.positive().max(64 * 1024 ** 2),
});
const archiveFields = {
  releaseTag: z.string().regex(/^assets-[a-f0-9]{16}$/),
  filename: z.literal('lantern-assets.tar.gz'),
  sha256: hash,
  inventorySha256: hash,
  bytes: bytes.positive(),
  recipeSha256: hash,
};
export const ArchiveLockSchema = z.strictObject({ schemaVersion: z.literal(1), ...archiveFields });
type ArchiveLock = z.infer<typeof ArchiveLockSchema>;
const preparation = z.strictObject({
  recipeSha256: hash,
  inputs: z.record(z.string(), hash),
  payloadSha256: hash,
});
export const LockSchema = z.union([
  ArchiveLockSchema,
  z
    .strictObject({
      schemaVersion: z.literal(2),
      ...archiveFields,
      preparation,
    })
    .superRefine((pin, ctx) => {
      if (
        createHash('sha256').update(JSON.stringify(pin.preparation.inputs)).digest('hex') !==
        pin.preparation.recipeSha256
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Accepted preparation input hashes differ from its recipe',
        });
    }),
  z
    .strictObject({
      schemaVersion: z.literal(3),
      ...archiveFields,
      preparation,
      bundles: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), ArchiveLockSchema),
      fileDelivery: FileDeliverySchema.optional(),
    })
    .superRefine((pin, ctx) => {
      if (
        !Object.keys(pin.bundles).length ||
        createHash('sha256').update(JSON.stringify(pin.preparation.inputs)).digest('hex') !==
          pin.preparation.recipeSha256
      )
        ctx.addIssue({ code: 'custom', message: 'Invalid bundle preparation identity' });
    }),
]);
export type AssetLock = z.infer<typeof LockSchema>;
export const acceptedRecipe = (lock: AssetLock) =>
  lock.schemaVersion !== 1 ? lock.preparation.recipeSha256 : lock.recipeSha256;
export type PackInventory = {
  schemaVersion: 1;
  recipeSha256: string;
  files: Record<string, { sha256: string; bytes: number }>;
};
// The only provenance-only payload file is deliberately named, never a folder exclusion.
export function payloadDigest(inventory: PackInventory) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(inventory.files)
          .filter(([file]) => file !== 'metadata/preparation-inputs.json')
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([file, value]) => [file, value.bytes, value.sha256]),
      ),
    )
    .digest('hex');
}
export function preparationPin(
  archive: AssetLock,
  inputs: Record<string, string>,
  inventory: PackInventory,
): AssetLock {
  const {
    preparation: __,
    schemaVersion: _,
    ...fields
  } = archive as AssetLock & { preparation?: unknown };
  return LockSchema.parse({
    schemaVersion: archive.schemaVersion === 3 ? 3 : 2,
    ...fields,
    preparation: {
      recipeSha256: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
      inputs,
      payloadSha256: payloadDigest(inventory),
    },
  });
}
export const PackSchema = z.strictObject({
  schemaVersion: z.literal(1),
  recipeSha256: hash,
  files: z.record(z.string(), z.strictObject({ sha256: hash, bytes })),
});
export const lockFile = path.join(projectRoot, 'assets/lock.json');
export const readLock = async (
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
) => LockSchema.parse(JSON.parse((await read('assets/lock.json')).toString()));
import { safeRelative, listFiles } from './files';
export async function validatePack(root: string, lock: AssetLock) {
  const inventory = await fs.readFile(path.join(root, 'pack.json'));
  if (createHash('sha256').update(inventory).digest('hex') !== lock.inventorySha256)
    throw new Error('Prepared inventory hash differs');
  const data = PackSchema.parse(JSON.parse(inventory.toString()));
  if (data.recipeSha256 !== lock.recipeSha256) throw new Error('Prepared pack recipe differs');
  const actual = (await listFiles(root)).filter((n) => !n.startsWith('.') && n !== 'pack.json'),
    expected = Object.keys(data.files).sort();
  if (actual.join('\n') !== expected.join('\n'))
    throw new Error('Prepared pack file inventory differs');
  for (const name of expected) {
    safeRelative(name);
    if (!/^(public|metadata)\//.test(name)) throw new Error('Unexpected pack file');
    const f = data.files[name]!,
      file = path.join(root, name);
    if ((await fs.stat(file)).size !== f.bytes || (await shaFile(file)) !== f.sha256)
      throw new Error(`Prepared asset differs: ${name}`);
  }
  if (lock.schemaVersion !== 1 && payloadDigest(data) !== lock.preparation.payloadSha256)
    throw new Error('Accepted preparation payload differs from the published pack');
  return data;
}
export async function validateCachedPack(root: string, lock: AssetLock) {
  const inventory = PackSchema.parse(await readJson(path.join(root, 'pack.json')));
  const names = [...Object.keys(inventory.files), 'pack.json'];
  const actual = (await listFiles(root)).filter((name) => !name.startsWith('.')).sort();
  if (actual.join('\n') !== names.sort().join('\n'))
    throw new Error('Prepared pack file inventory differs');
  // The inventory itself remains cryptographically checked on every acquisition.
  if (
    (await shaFile(path.join(root, 'pack.json'))) !== lock.inventorySha256 ||
    inventory.recipeSha256 !== lock.recipeSha256
  )
    throw new Error('Prepared inventory differs from pin');
  if (lock.schemaVersion !== 1 && payloadDigest(inventory) !== lock.preparation.payloadSha256)
    throw new Error('Accepted preparation payload differs from the published pack');
  await verifiedOutput(
    root,
    names,
    async () => {
      await validatePack(root, lock);
    },
    '.verified-pack.json',
  );
  return inventory;
}
export async function inspectArchive(file: string, maxBytes = CACHE_LIMIT) {
  const names = new Set<string>(),
    folded = new Set<string>();
  let total = 0;
  const parser = new tar.Parser({ strict: true, maxDecompressionRatio: 1000 });
  parser.on('entry', (entry) => {
    try {
      const name = entry.path.replace(/\/$/, '');
      safeRelative(name);
      if (entry.type !== 'File' && entry.type !== 'Directory')
        throw new Error('Archive links and special entries are forbidden');
      if (name !== 'pack.json' && !/^(public|metadata)(\/|$)/.test(name))
        throw new Error('Unexpected archive root');
      if (names.has(name) || folded.has(name.toLowerCase()))
        throw new Error('Archive duplicate or case collision');
      names.add(name);
      folded.add(name.toLowerCase());
      total += entry.size;
      if (!Number.isSafeInteger(total) || total > maxBytes)
        throw new Error('Archive exceeds cache budget');
    } catch (error) {
      parser.abort(error as Error);
    }
    entry.resume();
  });
  await pipeline(createReadStream(file), parser);
  if (!names.has('pack.json')) throw new Error('Archive has no inventory');
  return total;
}
// Read the authenticated inventory near the front of a delivery archive. This
// avoids a full decompression pass solely to size the upcoming extraction.
async function archiveInventory(file: string, lock: AssetLock) {
  const controller = new AbortController();
  let bytes: Buffer | undefined;
  const parser = new tar.Parser({ strict: true, maxDecompressionRatio: 1000 });
  parser.on('entry', (entry) => {
    if (entry.path !== 'pack.json') {
      entry.resume();
      return;
    }
    if (entry.type !== 'File' || entry.size > 64 * 1024 ** 2) {
      parser.abort(new Error('Invalid archive inventory'));
      return;
    }
    const chunks: Buffer[] = [];
    entry.on('data', (chunk: Buffer) => chunks.push(chunk));
    entry.on('end', () => {
      bytes = Buffer.concat(chunks);
      controller.abort();
    });
  });
  try {
    await pipeline(createReadStream(file), parser, { signal: controller.signal });
  } catch (error) {
    if (!bytes) throw error;
  }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== lock.inventorySha256)
    throw new Error('Prepared inventory hash differs');
  const inventory = PackSchema.parse(JSON.parse(bytes.toString()));
  if (inventory.recipeSha256 !== lock.recipeSha256) throw new Error('Prepared pack recipe differs');
  return { inventory, bytes: bytes.length };
}

async function extractArchive(file: string, directory: string, inventory: PackInventory) {
  const names = new Set<string>(),
    folded = new Set<string>();
  let failure: unknown;
  await tar.x({
    cwd: directory,
    file,
    strict: true,
    preservePaths: false,
    maxDecompressionRatio: 1000,
    filter(name, entry) {
      if (failure) return false;
      try {
        name = name.replace(/\/$/, '');
        safeRelative(name);
        if (!('type' in entry)) throw new Error('Archive extraction requires an entry');
        if (entry.type !== 'File' && entry.type !== 'Directory')
          throw new Error('Archive links and special entries are forbidden');
        if (name !== 'pack.json' && !/^(public|metadata)(\/|$)/.test(name))
          throw new Error('Unexpected archive root');
        if (names.has(name) || folded.has(name.toLowerCase()))
          throw new Error('Archive duplicate or case collision');
        names.add(name);
        folded.add(name.toLowerCase());
        if (
          entry.type === 'File' &&
          name !== 'pack.json' &&
          (!inventory.files[name] || inventory.files[name]!.bytes !== entry.size)
        )
          throw new Error('Archive entry differs from inventory: ' + name);
        return true;
      } catch (error) {
        failure = error;
        return false;
      }
    },
  });
  if (failure) throw failure;
}

export async function installMutex<T>(root: string, work: () => Promise<T>) {
  const file = path.join(root, '.install');
  for (let i = 0; ; i++) {
    try {
      await fs.writeFile(file, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(await fs.readFile(file, 'utf8'));
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          await fs.rm(file, { force: true });
          continue;
        }
      }
      if (i > 12000) throw new Error('Asset download is busy');
      await new Promise((done) => setTimeout(done, 50));
    }
  }
  await using _cleanup1 = onAsyncExit(() => fs.rm(file, { force: true }));
  return await work();
}
export async function ensurePack(
  lock: AssetLock,
  cache = new AssetCache(),
  request: typeof fetch = fetch,
  url = `https://github.com/Talyen/lantern-knight/releases/download/${lock.releaseTag}/${lock.filename}`,
) {
  const held = await cache.lease('pack-' + lock.sha256);
  try {
    await installMutex(held.root, async () => {
      try {
        await validateCachedPack(held.root, lock);
        return;
      } catch (validationError) {
        try {
          await fs.access(path.join(held.root, 'pack.json'));
          if (!(await held.sole()))
            throw new Error(
              'Corrupt prepared pack is in use; stop active commands before repairing it',
              { cause: validationError },
            );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (await installMatchingPreparation(held, lock, cache)) return;
      await held.reserve(lock.bytes + (await diskBytes(held.root)));
      const archive = path.join(held.root, '.download-' + randomUUID()),
        incoming = path.join(held.root, '.incoming-' + randomUUID());
      await using _scopeExit2 = onAsyncExit(async () => {
        await fs.rm(archive, { force: true });
        await fs.rm(incoming, { recursive: true, force: true });
        await held.reserve(0);
      });
      await downloadFile(url, lock, archive, request);
      const { inventory, bytes: inventoryBytes } = await archiveInventory(archive, lock);
      const unpacked = Object.values(inventory.files).reduce(
        (sum, file) => sum + file.bytes,
        inventoryBytes,
      );
      await held.reserve(unpacked + (await diskBytes(held.root)) + 4096);
      await fs.mkdir(incoming);
      await extractArchive(archive, incoming, inventory);
      await validatePack(incoming, lock);
      await fs.mkdir(path.join(incoming, 'metadata'), { recursive: true });
      for (const name of ['public', 'metadata', 'pack.json']) {
        await fs.rm(path.join(held.root, name), {
          recursive: true,
          force: true,
        });
        await fs.rename(path.join(incoming, name), path.join(held.root, name));
      }
      await verifiedOutput(
        held.root,
        [...Object.keys(inventory.files), 'pack.json'],
        async () => {},
        '.verified-pack.json',
      );
    });
    return held;
  } catch (error) {
    await held.release();
    throw error;
  }
}

export async function installMatchingPreparation(
  destination: Awaited<ReturnType<AssetCache['lease']>>,
  lock: AssetLock,
  cache: AssetCache,
) {
  const root = path.join(cache.root, 'entries', 'preparation');
  let prepared: ArchiveLock;
  try {
    prepared = ArchiveLockSchema.parse(await readJson(path.join(root, 'prepared.json')));
  } catch {
    return false;
  }
  if (prepared.sha256 !== lock.sha256 || prepared.inventorySha256 !== lock.inventorySha256)
    return false;
  const held = await cache.lease('preparation');
  const incoming = path.join(destination.root, '.incoming-' + randomUUID());
  await using _scopeExit1 = onAsyncExit(async () => {
    await fs.rm(incoming, { recursive: true, force: true });
    await held.release();
  });
  const payload = path.join(held.root, 'work/payload');
  let inventory: Awaited<ReturnType<typeof validatePack>>;
  try {
    inventory = await validatePack(payload, lock);
  } catch {
    return false;
  }
  await destination.reserve(
    Object.values(inventory.files).reduce((n, f) => n + f.bytes, 0) +
      64 * 1024 +
      (await diskBytes(destination.root)),
  );
  for (const file of [...Object.keys(inventory.files), 'pack.json']) {
    safeRelative(file);
    const target = path.join(incoming, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.link(path.join(payload, file), target);
  }
  await validatePack(incoming, lock);
  for (const name of ['public', 'metadata', 'pack.json']) {
    await fs.rm(path.join(destination.root, name), { recursive: true, force: true });
    await fs.rename(path.join(incoming, name), path.join(destination.root, name));
  }
  console.log('Reused exact pinned preparation payload; no download or extraction.');
  return true;
}
