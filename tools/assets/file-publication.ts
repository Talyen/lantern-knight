import { readJson, writeJsonAtomic } from '../json-file';
import { downloadFile } from './download';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { gzipSync } from 'node:zlib';
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
import { FileCatalogSchema, type FileCatalog, deliveryURL, containerURL } from './file-delivery';

type BundlePin = Extract<AssetLock, { schemaVersion: 3 }>;
type Container = { sha256: string; bytes: number };

// Immutable, uncompressed concatenations preserve byte addressing. Each object
// is stored once; aliases share its offset. No tar/gzip parsing runs in readers.
export async function buildFileCatalog(
  pin: BundlePin,
  inventory: PackInventory,
  sourceRoot: string,
  held: Awaited<ReturnType<AssetCache['lease']>>,
  accept: (container: Container, file: string) => Promise<void>,
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
  const infos = Object.fromEntries(unique);
  const groups = authoringGroups([...unique.keys()].sort(), infos);
  const peak = Math.max(
    1,
    ...[...groups.values()].map((hashes) =>
      hashes.reduce((sum, hash) => sum + unique.get(hash)!.bytes, 0),
    ),
  );
  await held.reserve(peak);
  let done = 0;
  for (const hashes of groups.values()) {
    const file = path.join(held.root, 'container.' + randomUUID());
    const output = await fs.open(file, 'wx');
    const digest = createHash('sha256');
    const offsets = new Map<string, number>();
    let offset = 0;
    try {
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
      console.log(`Individual file delivery: ${++done}/${groups.size} containers verified`);
    } finally {
      await output.close();
      await fs.rm(file, { force: true });
    }
  }
  const files = Object.fromEntries(
    Object.entries(inventory.files)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, info]) => [name, { ...info, ...locations.get(info.sha256)! }]),
  );
  return FileCatalogSchema.parse({
    schemaVersion: 1,
    payloadSha256: pin.preparation.payloadSha256,
    containers,
    files,
  });
}

export async function publishFileDelivery(
  pin: BundlePin,
  sourceRoot: string,
  cache = new AssetCache(),
  publish = gh,
  request: typeof fetch = fetch,
) {
  const held = await cache.lease('range-publication-' + pin.sha256, 0, true);
  const work = { ...held, root: path.join(held.root, 'work') };
  try {
    // Exclusive staging has no reusable source bytes. Remove only this owner's
    // interrupted work before reserving the new operation's bounded peak.
    await fs.rm(work.root, { recursive: true, force: true });
    await fs.mkdir(work.root, { recursive: true });
    const inventory = PackSchema.parse(await readJson(path.join(sourceRoot, 'pack.json')));
    const commit = (
      await publish([
        'api',
        'repos/Talyen/lantern-knight/git/ref/heads/main',
        '--jq',
        '.object.sha',
      ])
    ).trim();
    const upload = async (tag: string, filename: string, info: Container, source: string) => {
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
              commit,
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
    };
    const catalog = await buildFileCatalog(
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
    );
    // Prove range support on every published container before switching readers.
    for (const [hash, container] of Object.entries(catalog.containers)) {
      const file = Object.values(catalog.files).find((f) => f.container === hash && f.bytes > 0);
      if (!file) continue;
      const proof = path.join(work.root, 'range-proof');
      try {
        await downloadFile(containerURL(hash), file, proof, request, undefined, {
          offset: file.offset,
          totalBytes: container.bytes,
        });
      } finally {
        await fs.rm(proof, { force: true });
      }
    }
    const body = gzipSync(Buffer.from(JSON.stringify(catalog)), { level: 9 });
    const sha256 = createHash('sha256').update(body).digest('hex');
    const delivery = {
      releaseTag: 'assets-catalog-' + sha256.slice(0, 16),
      filename: 'files.json.gz' as const,
      sha256,
      bytes: body.length,
    };
    await held.reserve(body.length * 2);
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
  } finally {
    try {
      await fs.rm(work.root, { recursive: true, force: true });
    } finally {
      await held.release();
    }
  }
}

// Publish the accepted bytes without refreshing artwork or changing its pin.
export async function publishIndividualFiles(
  pin: BundlePin,
  cache = new AssetCache(),
  publish = gh,
  target = lockFile,
  request: typeof fetch = fetch,
) {
  const source = await ensureBundlePack(pin, cache, request);
  try {
    const fileDelivery = await publishFileDelivery(pin, source.root, cache, publish, request);
    const next = LockSchema.parse({ ...pin, fileDelivery });
    if (JSON.stringify(LockSchema.parse(await readJson(target))) !== JSON.stringify(pin))
      throw new Error('Asset pin changed during file publication; refusing to overwrite it');
    await writeJsonAtomic(target, next, true);
    console.log('Published and pinned individually downloadable asset files.');
  } finally {
    await source.release();
  }
}
