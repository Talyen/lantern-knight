import { onAsyncExit } from '../scope-exit';
import { readJson, writeJsonAtomic } from '../json-file';
import { downloadFile } from './download';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { AssetCache } from './cache';
import { safeRelative } from './files';
import {
  type AssetLock,
  type PackInventory,
  payloadDigest,
  PackSchema,
  lockFile,
  LockSchema,
} from './pack';
import { ensureBundlePack, authoringGroups } from './bundles';
import { gh } from './github';
import {
  FileCatalogSchema,
  parseFileCatalog,
  type FileCatalog,
  deliveryURL,
  containerURL,
} from './file-delivery';
import { publicationWork } from './publication-work';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
type Container = { sha256: string; bytes: number };

// Optional parallelism must not increase the minimum cache budget. Reserve one
// transfer and use additional slots only when the cache can grant their peak.
async function transferSlots(
  held: Awaited<ReturnType<AssetCache['lease']>>,
  sizes: number[],
  maximum: number,
) {
  const largest = sizes.sort((a, b) => b - a).slice(0, maximum);
  if (!largest.length) return 1;
  const granted = await held.reserveUpTo(
    largest[0]!,
    largest.reduce((a, b) => a + b, 0),
  );
  let bytes = 0;
  let slots = 0;
  for (const size of largest) {
    if (bytes + size > granted) break;
    bytes += size;
    slots++;
  }
  return Math.max(1, slots);
}

// Immutable, uncompressed concatenations preserve byte addressing. Each object
// is stored once; aliases share its offset. No tar/gzip parsing runs in readers.
export async function buildFileCatalog(
  pin: BundlePin,
  inventory: PackInventory,
  sourceRoot: string,
  held: Awaited<ReturnType<AssetCache['lease']>>,
  accept: (container: Container, file: string) => Promise<void>,
  previous?: FileCatalog,
) {
  if (payloadDigest(inventory) !== pin.preparation.payloadSha256)
    throw new Error('File catalog payload differs from pinned delivery');
  const unique = new Map<string, { name: string; bytes: number }>();
  for (const [name, info] of Object.entries(inventory.files)) {
    safeRelative(name);
    if (!/^(public|metadata)\//.test(name)) throw new Error('Unexpected delivery file');
    if (info.bytes >= 2 * 1024 ** 3)
      throw new Error('Asset exceeds GitHub single-file delivery limit: ' + name);
    const prior = unique.get(info.sha256);
    if (prior && prior.bytes !== info.bytes) throw new Error('Conflicting file hash sizes');
    unique.set(info.sha256, { name, bytes: info.bytes });
  }
  const locations = new Map<string, { container: string; offset: number }>();
  const containers: FileCatalog['containers'] = {};
  if (previous) {
    const prior = parseFileCatalog(previous, previous.payloadSha256);
    for (const info of Object.values(prior.files)) {
      const current = unique.get(info.sha256);
      if (!current || locations.has(info.sha256)) continue;
      if (current.bytes !== info.bytes) throw new Error('Conflicting file hash sizes');
      locations.set(info.sha256, { container: info.container, offset: info.offset });
      containers[info.container] = prior.containers[info.container]!;
    }
  }
  console.log(`Individual file delivery: reusing ${locations.size}/${unique.size} content hashes.`);
  const pending = [...unique.keys()].filter((hash) => !locations.has(hash)).sort();
  const groups = [...authoringGroups(pending, Object.fromEntries(unique)).values()];
  const concurrency = await transferSlots(
    held,
    groups.map((hashes) =>
      Math.max(
        1,
        hashes.reduce((sum, hash) => sum + unique.get(hash)!.bytes, 0),
      ),
    ),
    2,
  );
  let done = 0;
  await publicationWork(
    groups,
    async (hashes) => {
      const file = path.join(held.root, 'container.' + randomUUID());
      const output = await fs.open(file, 'wx');
      const digest = createHash('sha256');
      const offsets = new Map<string, number>();
      let offset = 0;
      await using _scopeExit1 = onAsyncExit(async () => {
        await output.close();
        await fs.rm(file, { force: true });
      });
      async function* content() {
        for (const hash of hashes) {
          const source = unique.get(hash)!;
          offsets.set(hash, offset);
          const proof = createHash('sha256');
          let bytes = 0;
          for await (const chunk of createReadStream(path.join(sourceRoot, source.name))) {
            bytes += chunk.length;
            proof.update(chunk);
            digest.update(chunk);
            yield chunk;
          }
          if (bytes !== source.bytes || proof.digest('hex') !== hash)
            throw new Error('Source file changed during publication: ' + source.name);
          offset += bytes;
        }
        if (!offset) {
          const sentinel = Buffer.alloc(1);
          digest.update(sentinel);
          yield sentinel;
        }
      }
      await pipeline(content(), output.createWriteStream());
      const sha256 = digest.digest('hex');
      const bytes = Math.max(1, offset);
      await accept({ sha256, bytes }, file);
      containers[sha256] = { bytes };
      for (const hash of hashes)
        locations.set(hash, { container: sha256, offset: offsets.get(hash)! });
      console.log(`Individual file delivery: ${++done}/${groups.length} new containers verified`);
    },
    concurrency,
  );
  const files = Object.fromEntries(
    Object.entries(inventory.files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, info]) => [name, { ...info, ...locations.get(info.sha256)! }]),
  );
  return FileCatalogSchema.parse({
    schemaVersion: 1,
    payloadSha256: pin.preparation.payloadSha256,
    containers: Object.fromEntries(
      Object.entries(containers).sort(([a], [b]) => a.localeCompare(b)),
    ),
    files,
  });
}

export async function publishFileDelivery(
  pin: BundlePin,
  sourceRoot: string | undefined,
  cache = new AssetCache(),
  publish = gh,
  request: typeof fetch = fetch,
  previous?: BundlePin,
) {
  const held = await cache.lease('range-publication-' + pin.sha256, 0, true);
  let granted = 0;
  const reserve = async (bytes: number) => {
    if (bytes <= granted) return;
    await held.reserve(bytes);
    granted = bytes;
  };
  const work = {
    ...held,
    root: path.join(held.root, 'work'),
    reserve,
    async reserveUpTo(bytes: number, preferred: number) {
      if (preferred <= granted) return granted;
      granted = await held.reserveUpTo(Math.max(bytes, granted), Math.max(preferred, granted));
      return granted;
    },
  };
  await using _scopeExit2 = onAsyncExit(async () => {
    await using _cleanup1 = onAsyncExit(() => held.release());
    await fs.rm(work.root, { recursive: true, force: true });
  });
  // Exclusive staging has no reusable source bytes. Remove only this owner's
  // interrupted work before reserving the new operation's bounded peak.
  await fs.rm(work.root, { recursive: true, force: true });
  await fs.mkdir(work.root, { recursive: true });
  const priorPin = previous ?? pin;
  let prior: FileCatalog | undefined;
  if (priorPin.fileDelivery) {
    const delivery = priorPin.fileDelivery;
    await reserve(delivery.bytes);
    const file = path.join(work.root, 'previous-catalog.gz');
    await downloadFile(
      deliveryURL(delivery.releaseTag, delivery.filename),
      delivery,
      file,
      request,
    );
    prior = parseFileCatalog(
      JSON.parse(
        gunzipSync(await fs.readFile(file), { maxOutputLength: 128 * 1024 ** 2 }).toString(),
      ),
      priorPin.preparation.payloadSha256,
    );
    await fs.rm(file);
  }
  if (!sourceRoot && (!prior || priorPin !== pin)) throw new Error('Missing publication source');
  const inventory = sourceRoot
    ? PackSchema.parse(await readJson(path.join(sourceRoot, 'pack.json')))
    : undefined;
  let commit: Promise<string> | undefined;
  const targetCommit = () =>
    (commit ??= publish([
      'api',
      'repos/Talyen/lantern-knight/git/ref/heads/main',
      '--jq',
      '.object.sha',
    ]).then((value) => value.trim()));
  const verifiedObjects = new Set<string>();
  const upload = async (tag: string, filename: string, info: Container, source?: string) => {
    let assets: { name: string; size: number; digest: string }[] = [];
    let exists = false;
    try {
      const release = JSON.parse(
        await publish(['api', `repos/Talyen/lantern-knight/releases/tags/${tag}`]),
      );
      assets = (
        JSON.parse(
          await publish([
            'api',
            '--paginate',
            '--slurp',
            `repos/Talyen/lantern-knight/releases/${release.id}/assets?per_page=100`,
          ]),
        ) as (typeof assets)[]
      ).flat();
      exists = true;
    } catch (error) {
      if (
        !/release not found|HTTP 404|Not Found/i.test(
          String(error) + String((error as { stderr?: string }).stderr),
        )
      )
        throw error;
    }
    const asset = assets.find((a) => a.name === filename);
    if (!asset) {
      if (!source) throw new Error('Published delivery object unavailable: ' + tag);
      const file = path.join(work.root, filename);
      await fs.link(source, file).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      });
      try {
        if (exists) await publish(['release', 'upload', tag, file]);
        else
          await publish([
            'release',
            'create',
            tag,
            file,
            '--target',
            await targetCommit(),
            '--title',
            'Content-addressed asset delivery',
            '--notes',
            'Immutable hash-verified bytes with individually addressable file ranges.',
            '--latest=false',
          ]);
      } finally {
        await fs.rm(file, { force: true });
      }
      const release = JSON.parse(
        await publish(['api', `repos/Talyen/lantern-knight/releases/tags/${tag}`]),
      );
      assets = release.assets;
    }
    const verified = assets.find((a) => a.name === filename);
    if (!verified || verified.size !== info.bytes || verified.digest !== 'sha256:' + info.sha256)
      throw new Error('Published delivery bytes differ: ' + tag + '/' + filename);
    verifiedObjects.add(info.sha256);
  };
  const catalog =
    inventory && sourceRoot
      ? await buildFileCatalog(
          pin,
          inventory,
          sourceRoot,
          work,
          async (container, file) =>
            await upload(
              'assets-objects-' + container.sha256.slice(0, 16),
              container.sha256 + '.bin',
              container,
              file,
            ),
          prior,
        )
      : prior!;
  // Prove range support on every published container before switching readers.
  const proofs = Object.entries(catalog.containers).flatMap(([hash, container]) => {
    const file = Object.values(catalog.files)
      .filter((f) => f.container === hash && f.bytes > 0)
      .sort((a, b) => a.bytes - b.bytes)[0];
    return [{ hash, container, file }];
  });
  const proofSlots = await transferSlots(
    work,
    proofs.map((p) => p.file?.bytes ?? 0),
    3,
  );
  await publicationWork(
    proofs,
    async ({ hash, container, file }) => {
      if (!verifiedObjects.has(hash))
        await upload('assets-objects-' + hash.slice(0, 16), hash + '.bin', {
          sha256: hash,
          bytes: container.bytes,
        });
      if (!file) return;
      const proof = path.join(work.root, 'range-proof-' + hash);
      await using _cleanup2 = onAsyncExit(() => fs.rm(proof, { force: true }));
      await downloadFile(containerURL(hash), file, proof, request, undefined, {
        offset: file.offset,
        totalBytes: container.bytes,
      });
    },
    proofSlots,
  );
  if (!inventory) return pin.fileDelivery!;
  const body = gzipSync(Buffer.from(JSON.stringify(catalog)), { level: 9 });
  const sha256 = createHash('sha256').update(body).digest('hex');
  const delivery = {
    releaseTag: 'assets-catalog-' + sha256.slice(0, 16),
    filename: 'files.json.gz' as const,
    sha256,
    bytes: body.length,
  };
  await reserve(body.length * 2);
  const file = path.join(work.root, 'catalog-candidate.gz');
  await fs.writeFile(file, body);
  await upload(delivery.releaseTag, delivery.filename, delivery, file);
  await downloadFile(
    deliveryURL(delivery.releaseTag, delivery.filename),
    delivery,
    path.join(work.root, 'verified-catalog.gz'),
    request,
  );
  await fs.rm(file, { force: true });
  await fs.rm(path.join(work.root, 'verified-catalog.gz'), { force: true });
  return delivery;
}

// Publish the accepted bytes without refreshing artwork or changing its pin.
export async function publishIndividualFiles(
  pin: BundlePin,
  cache = new AssetCache(),
  publish = gh,
  target = lockFile,
  request: typeof fetch = fetch,
) {
  const source = pin.fileDelivery ? undefined : await ensureBundlePack(pin, cache, request);
  await using _cleanup3 = onAsyncExit(async () => {
    await source?.release();
  });
  const fileDelivery = await publishFileDelivery(pin, source?.root, cache, publish, request);
  const next = LockSchema.parse({ ...pin, fileDelivery });
  if (JSON.stringify(LockSchema.parse(await readJson(target))) !== JSON.stringify(pin))
    throw new Error('Asset pin changed during file publication; refusing to overwrite it');
  if (JSON.stringify(next) !== JSON.stringify(pin)) await writeJsonAtomic(target, next, true);
  console.log(
    pin.fileDelivery
      ? 'Verified existing individual delivery; no payload acquisition or uploads.'
      : 'Published and pinned individually downloadable asset files.',
  );
}
