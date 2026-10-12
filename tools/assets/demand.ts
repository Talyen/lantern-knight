import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { AssetCache, diskBytes } from './cache';
import { safeRelative } from './files';
import { ensurePack, PackSchema, type AssetLock, type PackInventory } from './pack';
import { shaFile } from './sources';
import { fileSignature } from '../verified-files';
import { openFileWorkspace } from './file-delivery';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const archiveURL = (pin: AssetLock) =>
  `https://github.com/Talyen/lantern-knight/releases/download/${pin.releaseTag}/${pin.filename}`;

// Only the requested regular file is materialized. Its bytes are authenticated
// against the pinned inventory, so a partial archive never becomes a trusted pack.
async function remoteEntry(
  pin: AssetLock,
  name: string,
  request: typeof fetch,
  signal: AbortSignal,
  prefix?: number,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.throwIfAborted();
  signal.addEventListener('abort', abort, { once: true });
  let result: Buffer | undefined;
  try {
    const response = await request(archiveURL(pin), {
      signal: controller.signal,
      headers: prefix ? { Range: `bytes=0-${prefix - 1}` } : {},
    });
    if (!response.ok || !response.body)
      throw new Error(`Asset archive unavailable: HTTP ${response.status}`);
    const parser = new tar.Parser({ strict: true, maxDecompressionRatio: 1000 });
    parser.on('entry', (entry) => {
      if (entry.path !== name) {
        entry.resume();
        return;
      }
      if (entry.type !== 'File' || entry.size > 64 * 1024 ** 2) {
        parser.abort(new Error('Invalid asset metadata entry'));
        return;
      }
      const chunks: Buffer[] = [];
      entry.on('data', (chunk: Buffer) => chunks.push(chunk));
      entry.on('end', () => {
        result = Buffer.concat(chunks);
        controller.abort();
        parser.abort(new Error('Requested entry complete'));
      });
    });
    let transferred = 0;
    async function* bounded() {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        transferred += chunk.length;
        if (transferred > pin.bytes || (prefix && transferred > prefix && response.status === 200))
          throw new Error('Asset archive response exceeds requested size');
        yield chunk;
      }
    }
    try {
      await pipeline(bounded(), parser);
    } catch (error) {
      if (!result && !prefix) throw error;
    }
    signal.throwIfAborted();
    return result;
  } finally {
    controller.abort();
    signal.removeEventListener('abort', abort);
  }
}

export async function openDemandWorkspace(
  pin: BundlePin,
  cache = new AssetCache(),
  request: typeof fetch = fetch,
) {
  if (pin.fileDelivery) return openFileWorkspace(pin, cache, request);
  if (!pin.bundles.runtime) throw new Error('On-demand artwork requires a runtime bundle');
  const held = await cache.lease('demand-' + pin.sha256);
  const lifetime = new AbortController();
  const pending = new Map<string, Promise<boolean>>();
  const inventories = new Map<string, Promise<PackInventory>>();
  const proofs = new Map<string, string>();
  let reserved: number;
  try {
    reserved = await diskBytes(held.root);
  } catch (error) {
    await held.release();
    throw error;
  }
  let granted = reserved;
  let reservation = Promise.resolve();
  const reserve = (bytes: number) => {
    reserved += bytes;
    reservation = reservation
      .catch(() => {})
      .then(async () => {
        if (reserved <= granted) return;
        const quantum = Math.min(64 * 1024 ** 2, Math.max(4096, Math.floor(cache.limit / 32)));
        const target = Math.ceil(reserved / quantum) * quantum;
        await held.reserve(target);
        granted = target;
      });
    return reservation.catch((error: unknown) => {
      reserved -= bytes;
      throw error;
    });
  };
  let active = 0;
  const waiting: (() => void)[] = [];
  const announced = new Set<string>();
  const parts = new Map<string, { users: number; promise: ReturnType<typeof ensurePack> }>();
  const withPart = async (name: string, copy: (root: string) => Promise<void>) => {
    let part = parts.get(name);
    if (!part) {
      const promise = (async () => {
        if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
        else active++;
        try {
          lifetime.signal.throwIfAborted();
          if (!announced.has(name)) {
            announced.add(name);
            console.log(
              `Artwork bundle: ${name} (${Math.round(pin.bundles[name]!.bytes / 1024 ** 2)} MiB; cached files are reused)`,
            );
          }
          return await ensurePack(pin.bundles[name]!, cache, (url, init) =>
            request(url, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, lifetime.signal])
                : lifetime.signal,
            }),
          );
        } catch (error) {
          const next = waiting.shift();
          if (next) next();
          else active--;
          throw error;
        }
      })();
      part = { users: 0, promise };
      parts.set(name, part);
    }
    part.users++;
    try {
      await copy((await part.promise).root);
    } finally {
      if (--part.users === 0) {
        parts.delete(name);
        const acquired = await part.promise.catch(() => undefined);
        if (acquired) {
          try {
            await acquired.release();
          } finally {
            const next = waiting.shift();
            if (next) next();
            else active--;
          }
        }
      }
    }
  };
  let streaming = 0;
  const streams: (() => void)[] = [];
  const metadata = async (part: AssetLock, relative: string) => {
    if (streaming >= 2) await new Promise<void>((resolve) => streams.push(resolve));
    else streaming++;
    try {
      return await remoteEntry(part, relative, request, lifetime.signal);
    } finally {
      const next = streams.shift();
      if (next) next();
      else streaming--;
    }
  };
  const inventory = (name: string) => {
    let promise = inventories.get(name);
    if (promise) return promise;
    promise = (async () => {
      const part = pin.bundles[name]!;
      const file = path.join(held.root, 'inventories', part.sha256 + '.json');
      let bytes: Buffer | undefined;
      for (const candidate of [
        file,
        path.join(cache.root, 'entries', 'pack-' + part.sha256, 'pack.json'),
      ]) {
        try {
          const data = await fs.readFile(candidate);
          if (digest(data) === part.inventorySha256) {
            bytes = data;
            break;
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (!bytes) {
        console.log(`Artwork inventory: ${name}`);
        for (const prefix of [256 * 1024, 2 * 1024 ** 2, 16 * 1024 ** 2]) {
          bytes = await remoteEntry(part, 'pack.json', request, lifetime.signal, prefix);
          if (bytes) break;
        }
        if (!bytes || digest(bytes) !== part.inventorySha256)
          throw new Error('Artwork inventory differs from pin: ' + name);
        await reserve(bytes.length);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bytes);
      }
      const parsed = PackSchema.parse(JSON.parse(bytes.toString()));
      if (parsed.recipeSha256 !== part.recipeSha256)
        throw new Error('Artwork inventory recipe differs: ' + name);
      for (const name of Object.keys(parsed.files)) safeRelative(name);
      return parsed;
    })();
    inventories.set(name, promise);
    promise.catch(() => inventories.delete(name));
    return promise;
  };
  // Inspect authenticated inventories with bounded concurrency. No painting or
  // animation pages are downloaded merely to determine which shard owns a file.
  let index:
    Promise<Map<string, { bundle: string; info: PackInventory['files'][string] }>> | undefined;
  const owners = () =>
    (index ??= (async () => {
      const names = Object.keys(pin.bundles),
        result = new Map<string, { bundle: string; info: PackInventory['files'][string] }>();
      let next = 0;
      let failure: unknown;
      const folded = new Set<string>();
      await Promise.all(
        Array.from({ length: Math.min(3, names.length) }, async () => {
          while (!failure && next < names.length) {
            try {
              lifetime.signal.throwIfAborted();
              const bundle = names[next++]!;
              for (const [file, info] of Object.entries((await inventory(bundle)).files)) {
                if (folded.has(file.toLowerCase()))
                  throw new Error('Duplicate or case-colliding bundle file: ' + file);
                folded.add(file.toLowerCase());
                result.set(file, { bundle, info });
              }
            } catch (error) {
              failure = error;
            }
          }
        }),
      );
      if (failure) throw failure;
      return result;
    })().catch((error: unknown) => {
      index = undefined;
      throw error;
    }));
  const ensure = async (relative: string): Promise<boolean> => {
    safeRelative(relative);
    lifetime.signal.throwIfAborted();
    let owner: { bundle: string; info: PackInventory['files'][string] } | undefined;
    for (const bundle of ['runtime', 'bootstrap']) {
      if (!pin.bundles[bundle]) continue;
      const info = (await inventory(bundle)).files[relative];
      if (info) {
        owner = { bundle, info };
        break;
      }
    }
    owner ??= (await owners()).get(relative);
    if (!owner) return false;
    const file = path.join(held.root, relative);
    try {
      const stat = await fs.lstat(file);
      const signature = fileSignature(stat);
      if (
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size === owner.info.bytes &&
        (proofs.get(relative) === signature || (await shaFile(file)) === owner.info.sha256)
      ) {
        proofs.set(relative, signature);
        return true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const part = pin.bundles[owner.bundle]!;
    const cached = path.join(cache.root, 'entries', 'pack-' + part.sha256, relative);
    let bytes: Buffer | undefined;
    // Metadata and thumbnail previews need no surrounding artwork installation.
    if (
      (relative.endsWith('.json') || relative.endsWith('/preview.png')) &&
      !['runtime', 'bootstrap'].includes(owner.bundle)
    ) {
      try {
        bytes = await fs.readFile(cached);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (!bytes || digest(bytes) !== owner.info.sha256) {
        console.log(`Artwork metadata: ${relative}`);
        bytes = await metadata(part, relative);
      }
      if (!bytes || bytes.length !== owner.info.bytes || digest(bytes) !== owner.info.sha256)
        throw new Error('Artwork metadata differs from pin: ' + relative);
    }
    await reserve(owner.info.bytes);
    const temporary = file + '.' + randomUUID();
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      if (bytes) await fs.writeFile(temporary, bytes);
      else {
        await withPart(owner.bundle, async (root) => {
          lifetime.signal.throwIfAborted();
          await fs.copyFile(path.join(root, relative), temporary);
        });
      }
      lifetime.signal.throwIfAborted();
      await fs.rename(temporary, file);
      proofs.set(relative, fileSignature(await fs.stat(file)));
      return true;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  };
  return {
    root: held.root,
    publicDirectory: path.join(held.root, 'public'),
    metadataDirectory: path.join(held.root, 'metadata'),
    identity: pin.sha256,
    recipe: pin.recipeSha256,
    scope: 'authoring' as const,
    ensurePublicFile(relative: string) {
      const name = 'public/' + safeRelative(relative);
      let promise = pending.get(name);
      if (!promise) {
        promise = ensure(name).finally(() => pending.delete(name));
        pending.set(name, promise);
      }
      return promise;
    },
    async release() {
      lifetime.abort();
      await Promise.allSettled([...pending.values(), ...inventories.values()]);
      await held.release();
    },
  };
}
