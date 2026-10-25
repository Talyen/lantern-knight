import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PackSchema, payloadDigest, type AssetLock, type PackInventory, LockSchema } from './pack';
import { projectRoot } from './paths';
import { safeRelative } from './files';
import { shaFile } from './sources';
import type { AssetScope } from './bundles';
import { leaseRepositoryAssembly } from './repository-cache';

export type RepositoryPin = Extract<AssetLock, { schemaVersion: 5 }>;
const inventoryName = (hash: string) => `asset-data/inventories/${hash}.json.gz`;
const objectFile = (root: string, hash: string) =>
  path.join(root, 'asset-data/objects', hash.slice(0, 2), hash);

async function regular(file: string, base: string) {
  base = path.resolve(base);
  let current = path.resolve(file);
  while (true) {
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink())
      throw new Error('Repository assets cannot follow symlinks: ' + current);
    if (current === base) break;
    const parent = path.dirname(current);
    if (parent === current) throw new Error('Asset escaped repository');
    current = parent;
  }
  if (!(await fs.lstat(file)).isFile()) throw new Error('Missing regular asset: ' + file);
}

// Immutable bytes belong to Git. This checkout-local assembly is disposable and
// can always be reconstructed without Documents, GitHub or the shared cache.
export async function readRepositoryInventory(pin: RepositoryPin, root = projectRoot) {
  const file = path.join(root, inventoryName(pin.inventorySha256));
  await regular(file, root);
  const compressed = await fs.readFile(file);
  if (createHash('sha256').update(compressed).digest('hex') !== pin.inventorySha256)
    throw new Error('Repository asset inventory differs from pin');
  const inventory = PackSchema.parse(
    JSON.parse(gunzipSync(compressed, { maxOutputLength: 128 * 1024 ** 2 }).toString()),
  );
  if (inventory.recipeSha256 !== pin.recipeSha256 || payloadDigest(inventory) !== pin.sha256)
    throw new Error('Repository asset payload differs from pin');
  for (const name of Object.keys(inventory.files)) {
    safeRelative(name);
    if (!/^(public|metadata)\//.test(name)) throw new Error('Invalid repository asset path');
  }
  return inventory;
}
export async function openRepositoryWorkspace(
  pin: RepositoryPin,
  scope: AssetScope = 'authoring',
  demand = true,
  root = projectRoot,
) {
  root = path.resolve(root);
  const inventory = await readRepositoryInventory(pin, root);
  const directory = path.join(root, '.cache/repository-assets', pin.sha256);
  const lease = await leaseRepositoryAssembly(root, pin.sha256, pin.bytes);
  const pending = new Map<string, Promise<boolean>>();
  let released = false;
  const ensure = (name: string) => {
    if (released) return Promise.reject(new Error('Repository asset workspace is closed'));
    safeRelative(name);
    const info = inventory.files[name];
    if (!info) return Promise.resolve(false);
    let task = pending.get(name);
    if (!task) {
      task = (async () => {
        const target = path.join(directory, name);
        try {
          await regular(target, root);
          if (
            (await fs.stat(target)).size === info.bytes &&
            (await shaFile(target)) === info.sha256
          )
            return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        const source = objectFile(root, info.sha256);
        await regular(source, root);
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = target + '.' + randomUUID();
        try {
          await fs.copyFile(source, temporary, constants.COPYFILE_FICLONE);
          if (
            (await fs.stat(temporary)).size !== info.bytes ||
            (await shaFile(temporary)) !== info.sha256
          )
            throw new Error('Repository asset is missing or corrupt: ' + name);
          await fs.rename(temporary, target);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        return true;
      })().finally(() => pending.delete(name));
      pending.set(name, task);
    }
    return task;
  };
  const workspace = {
    root: directory,
    scope,
    publicDirectory: path.join(directory, 'public'),
    metadataDirectory: path.join(directory, 'metadata'),
    identity: pin.sha256,
    recipe: pin.recipeSha256,
    ensurePublicFile: (name: string) => ensure('public/' + safeRelative(name)),
    ensureMetadataFile: (name: string) => ensure('metadata/' + safeRelative(name)),
    async release() {
      released = true;
      await Promise.allSettled([...pending.values()]);
      await lease.release();
    },
  };
  try {
    if (!demand && scope === 'runtime') {
      const { selectedFiles } = await import('../select-runtime-assets');
      await selectedFiles(workspace.publicDirectory, 'runtime', workspace.ensurePublicFile);
    } else if (!demand) {
      const names = Object.keys(inventory.files);
      for (let offset = 0; offset < names.length; offset += 8)
        await Promise.all(names.slice(offset, offset + 8).map(ensure));
    }
    return workspace;
  } catch (error) {
    await workspace.release();
    throw error;
  }
}

// Acceptance copies verified bytes before changing the pin. Failure leaves the
// old pin usable. Unreferenced objects are harmless and can be reused on retry.
export async function saveRepositoryAssets(
  source: string,
  inventory: PackInventory,
  preparation: RepositoryPin['preparation'],
  root = projectRoot,
  reuse?: { inventory: PackInventory; expectedPin: string },
) {
  root = path.resolve(root);
  PackSchema.parse(inventory);
  const lockFile = path.join(root, 'assets/lock.json');
  const originalPin = await fs.readFile(lockFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (reuse && (!originalPin || JSON.parse(originalPin).sha256 !== reuse.expectedPin))
    throw new Error('Asset pin changed before derivative acceptance');
  const hashes = new Set<string>();
  let count = 0;
  for (const [name, info] of Object.entries(inventory.files)) {
    safeRelative(name);
    if (!/^(public|metadata)\//.test(name)) throw new Error('Invalid repository asset path');
    if (hashes.has(info.sha256)) continue;
    hashes.add(info.sha256);
    const target = objectFile(root, info.sha256);
    const reused = reuse?.inventory.files[name]?.sha256 === info.sha256;
    const input = reused ? objectFile(root, info.sha256) : path.join(source, name);
    await regular(input, reused ? root : source);
    if ((await fs.stat(input)).size !== info.bytes || (await shaFile(input)) !== info.sha256)
      throw new Error('Prepared asset changed before acceptance: ' + name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await regular(target, root);
      if ((await shaFile(target)) !== info.sha256)
        throw new Error('Corrupt repository asset object');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const temporary = target + '.' + randomUUID();
      try {
        await fs.copyFile(input, temporary, constants.COPYFILE_FICLONE | constants.COPYFILE_EXCL);
        if ((await shaFile(temporary)) !== info.sha256)
          throw new Error('Asset changed while copying: ' + name);
        await fs.link(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    if (++count % 10000 === 0) console.log(`Accepted ${count} unique asset objects.`);
  }
  const compressed = gzipSync(JSON.stringify(inventory), { level: 9 });
  const sha256 = payloadDigest(inventory);
  if (sha256 !== preparation.payloadSha256) throw new Error('Accepted asset payload differs');
  const pin = LockSchema.parse({
    schemaVersion: 5,
    sha256,
    inventorySha256: createHash('sha256').update(compressed).digest('hex'),
    bytes: Object.values(inventory.files).reduce((sum, file) => sum + file.bytes, 0),
    recipeSha256: inventory.recipeSha256,
    preparation,
  });
  const output = path.join(root, inventoryName(pin.inventorySha256));
  // Inventory names include their hash so accepting a new pin cannot damage the
  // inventory referenced by an old pin while another reader is opening it.
  await fs.mkdir(path.dirname(output), { recursive: true });
  const next = output + '.' + randomUUID();
  await fs.writeFile(next, compressed);
  await fs.rename(next, output);
  const currentPin = await fs.readFile(lockFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (currentPin !== originalPin) throw new Error('Asset pin changed during acceptance');
  const lockTemporary = lockFile + '.' + randomUUID();
  await fs.writeFile(lockTemporary, JSON.stringify(pin, null, 2) + '\n');
  await fs.rename(lockTemporary, lockFile);
  console.log(
    `Repository snapshot: ${Object.keys(inventory.files).length} files, ${hashes.size} unique objects.`,
  );
  return pin;
}
