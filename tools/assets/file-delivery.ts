import { downloadFile } from './download';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { AssetCache, diskBytes } from './cache';
import { safeRelative } from './files';
import { fileSignature } from '../verified-files';
import { shaFile } from './sources';
import { type AssetLock, payloadDigest } from './pack';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const FileCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  payloadSha256: hash,
  containers: z.record(
    hash,
    z.strictObject({
      bytes: z
        .number()
        .int()
        .positive()
        .max(2 * 1024 ** 3 - 1),
    }),
  ),
  files: z.record(
    z.string(),
    z.strictObject({
      sha256: hash,
      bytes: z.number().int().nonnegative(),
      container: hash,
      offset: z.number().int().nonnegative(),
    }),
  ),
});
export type FileCatalog = z.infer<typeof FileCatalogSchema>;
export const deliveryURL = (releaseTag: string, filename: string) =>
  `https://github.com/Talyen/lantern-knight/releases/download/${releaseTag}/${filename}`;
export const containerURL = (hash: string) =>
  deliveryURL('assets-objects-' + hash.slice(0, 16), hash + '.bin');

export async function openFileWorkspace(
  pin: BundlePin,
  cache = new AssetCache(),
  request: typeof fetch = fetch,
) {
  const delivery = pin.fileDelivery;
  if (!delivery) throw new Error('Missing individual file delivery');
  const held = await cache.lease('files-' + delivery.sha256);
  const lifetime = new AbortController();
  const pending = new Map<string, Promise<boolean>>();
  const objects = new Map<string, Promise<void>>();
  const proofs = new Map<string, string>();
  let catalogPromise: Promise<FileCatalog> | undefined;
  let active = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T>(work: () => Promise<T>) => {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      lifetime.signal.throwIfAborted();
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
  const valid = async (file: string, info: { bytes: number; sha256: string }) => {
    try {
      const stat = await fs.lstat(file),
        signature = fileSignature(stat);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== info.bytes) return false;
      if (proofs.get(file) !== signature && (await shaFile(file)) !== info.sha256) return false;
      proofs.set(file, signature);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  };
  // Accounting follows unique hashes; aliases are hardlinks, not extra copies.
  let initialBytes: number;
  try {
    initialBytes = await diskBytes(held.root);
  } catch (error) {
    await held.release();
    throw error;
  }
  let granted = initialBytes;
  const sizes = new Map<string, number>();
  let accounting = Promise.resolve();
  const reserve = (key: string, bytes: number) => {
    sizes.set(key, bytes);
    accounting = accounting
      .catch(() => {})
      .then(async () => {
        const required = initialBytes + [...sizes.values()].reduce((a, b) => a + b, 0);
        if (required <= granted) return;
        const quantum = Math.min(64 * 1024 ** 2, Math.max(4096, Math.floor(cache.limit / 32)));
        const target = Math.min(cache.limit, Math.ceil(required / quantum) * quantum);
        if (target < required) throw new Error('File workspace exceeds cache budget');
        await held.reserve(target);
        granted = target;
      });
    return accounting;
  };
  const catalog = () =>
    (catalogPromise ??= (async () => {
      const file = path.join(held.root, 'files.json.gz');
      await reserve('catalog', delivery.bytes);
      if (!(await valid(file, delivery)))
        await slot(() =>
          downloadFile(
            deliveryURL(delivery.releaseTag, delivery.filename),
            delivery,
            file,
            request,
            lifetime.signal,
          ),
        );
      const result = FileCatalogSchema.parse(
        JSON.parse(
          gunzipSync(await fs.readFile(file), { maxOutputLength: 128 * 1024 ** 2 }).toString(),
        ),
      );
      if (
        result.payloadSha256 !== pin.preparation.payloadSha256 ||
        payloadDigest({ schemaVersion: 1, recipeSha256: pin.recipeSha256, files: result.files }) !==
          result.payloadSha256
      )
        throw new Error('File catalog payload differs from pin');
      const folded = new Set<string>();
      for (const name of Object.keys(result.files)) {
        safeRelative(name);
        if (!/^(public|metadata)\//.test(name) || folded.has(name.toLowerCase()))
          throw new Error('Invalid file catalog path');
        const info = result.files[name]!;
        const container = result.containers[info.container];
        if (!container || info.offset + info.bytes > container.bytes)
          throw new Error('Invalid asset byte range');
        folded.add(name.toLowerCase());
      }
      return result;
    })().catch((error: unknown) => {
      catalogPromise = undefined;
      throw error;
    }));
  const ensure = async (relative: string) => {
    lifetime.signal.throwIfAborted();
    const index = await catalog();
    const info = index.files[relative];
    if (!info) return false;
    const target = path.join(held.root, relative);
    await reserve(info.sha256, info.bytes);
    if (await valid(target, info)) return true;
    let object = objects.get(info.sha256);
    if (!object) {
      object = slot(async () => {
        const file = path.join(held.root, 'objects', info.sha256);
        if (!(await valid(file, info)))
          await downloadFile(containerURL(info.container), info, file, request, lifetime.signal, {
            offset: info.offset,
            totalBytes: index.containers[info.container]!.bytes,
          });
      }).finally(() => objects.delete(info.sha256));
      objects.set(info.sha256, object);
    }
    await object;
    lifetime.signal.throwIfAborted();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = target + '.' + randomUUID();
    try {
      await fs.link(path.join(held.root, 'objects', info.sha256), temporary);
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return true;
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
      await Promise.allSettled([
        ...pending.values(),
        ...objects.values(),
        ...(catalogPromise ? [catalogPromise] : []),
      ]);
      await held.release();
    },
  };
}
