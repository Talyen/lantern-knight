import { onAsyncExit } from '../../tools/scope-exit';
import { writeJson, readJson } from '../../tools/json-file';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { manifestFixture } from '../fixtures/manifest';
import { gameAssetCatalog } from '../../src/content/game-content';
import { assetCatalog } from '../../src/content/asset-catalog';
import { loadingVideoPath } from '../../src/content/loading-media';
import { AssetCache, diskBytes } from '../../tools/assets/cache';
import { makeArchive, inventoryCandidate } from '../../tools/assets/archive';
import { recipeHash, LockSchema, type AssetLock } from '../../tools/assets/pack';
import { publishBundledPrepared, verifyRemote } from '../../tools/assets/publication';
import { ensureBundlePack, authoringGroups } from '../../tools/assets/bundles';

test('split publication uses downloadable filenames, frees the candidate archive and preserves the pin on failure', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-publication-'),
    cache = new AssetCache(path.join(root, 'cache')),
    held = await cache.lease('preparation'),
    payload = path.join(held.root, 'payload'),
    archive = path.join(held.root, 'candidate.tar.gz'),
    target = path.join(root, 'lock.json'),
    page = Buffer.from('fixture artwork'),
    hash = createHash('sha256').update(page).digest('hex');
  const write = async (name: string, bytes: string | Buffer) => {
    const file = path.join(payload, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  };
  await using _cleanup2 = onAsyncExit(() => held.release());
  for (const [id, file] of Object.entries({ ...assetCatalog, ...gameAssetCatalog })) {
    const manifest = manifestFixture(id);
    manifest.pages[0]!.hash = hash;
    await write('public/' + file, JSON.stringify(manifest));
    await write('public/' + path.posix.join(path.posix.dirname(file), 'atlas.png'), page);
  }
  for (const file of [
    'build-mode.json',
    'generated/calibration.json',
    'registration.json',
    'animation/flow.png',
    loadingVideoPath,
  ])
    await write('public/' + file, '{}');
  await write('public/lighting/manifest.json', JSON.stringify({ entries: {} }));
  await write('public/audio/manifest.json', JSON.stringify({ schemaVersion: 1, samples: [] }));
  await write('public/authoring-only.png', 'distinct authoring artwork');
  for (let i = 0; i < 200; i++) await write(`public/authoring/${i}.png`, `distinct source ${i}`);
  await write('public/generated/library/catalog.json', '{}');
  await write('public/generated/library/index.json', '{}');
  await write('public/generated/delivery/fixture/preview.png', 'small preview');
  let reservations = 0,
    granted = 0;
  const lock = await makeArchive(payload, archive, await recipeHash()),
    candidate = {
      held: {
        ...held,
        reserveUpTo: async (bytes: number, preferred: number) => {
          reservations++;
          return (granted = await held.reserveUpTo(bytes, preferred));
        },
      },
      payload,
      archive,
      lock,
    },
    uploads = new Map<string, Buffer>();
  await writeJson(target, lock);
  const remoteAssets = (tag: string) =>
    [...uploads]
      .filter(([key]) => key.startsWith(tag + '/'))
      .map(([key, bytes]) => ({
        name: key.split('/').at(-1)!,
        size: bytes.length,
        digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
      }));
  const releases = new Set<string>();
  const publish = async (args: string[]) => {
    if (args[0] === 'api') {
      if (args[1]?.includes('git/ref')) return 'a'.repeat(40);
      if (args.includes('--paginate')) {
        const tag = args.at(-1)!.split('/').at(-2)!;
        return JSON.stringify([remoteAssets(tag)]);
      }
      const tag = args[1]!.split('/').at(-1)!;
      if (!releases.has(tag)) throw new Error('HTTP 404');
      return JSON.stringify({ id: tag, assets: remoteAssets(tag) });
    }
    const tag = args[2]!;
    if (args[1] === 'view') {
      if (!releases.has(tag)) throw new Error('release not found');
      return JSON.stringify({ assets: remoteAssets(tag) });
    }
    assert.ok(['create', 'upload'].includes(args[1]!));
    releases.add(tag);
    for (const argument of args.slice(3)) {
      if (argument.startsWith('--')) break;
      const file = argument.split('#')[0]!;
      uploads.set(tag + '/' + path.basename(file), await fs.readFile(file));
    }
    return '';
  };
  const request: typeof fetch = async (url, init) => {
    const parsed = new URL(url instanceof Request ? url.url : url);
    const bytes = uploads.get(parsed.pathname.split('/').slice(-2).join('/'));
    assert.ok(bytes);
    const range = new Headers(init?.headers).get('Range');
    if (range) {
      const [start, end] = range.slice(6).split('-').map(Number) as [number, number];
      return new Response(Uint8Array.from(bytes.subarray(start, end + 1)), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
      });
    }
    return new Response(Uint8Array.from(bytes));
  };
  const verify = async (part: AssetLock) => {
    const bytes = uploads.get(part.releaseTag + '/' + part.filename);
    assert.ok(bytes, 'the pinned download filename must exist');
    assert.equal(bytes.length, part.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256);
  };
  await assert.rejects(
    publishBundledPrepared(
      candidate,
      publish,
      verify,
      target,
      async () => {
        throw new Error('interrupted before pin');
      },
      request,
      cache,
    ),
    /interrupted before pin/,
  );
  assert.deepEqual(await readJson(target), lock);
  assert.equal(reservations, 1, 'small shards share one bounded growth reservation');
  assert.ok((await diskBytes(held.root)) <= granted, 'publication stays within its reservation');
  await assert.rejects(fs.access(archive), { code: 'ENOENT' });
  const inventoryLock = await inventoryCandidate(payload, lock.recipeSha256);
  await publishBundledPrepared(
    { held, payload, lock: inventoryLock },
    publish,
    verify,
    target,
    async () => {},
    request,
    cache,
  );
  const pin = LockSchema.parse(await readJson(target));
  assert.equal(pin.schemaVersion, 3);
  if (pin.schemaVersion !== 3) throw new Error('Expected split pin');
  assert.ok(Object.keys(pin.bundles).filter((name) => name.startsWith('authoring-')).length > 40);
  assert.ok(pin.fileDelivery, 'individual files are verified before pinning');
  assert.ok(pin.bundles.bootstrap, 'metadata and thumbnails have their own bootstrap bundle');
  const acquired = await ensureBundlePack(pin, cache, async (url) => {
    const parsed = new URL(url instanceof Request ? url.url : url),
      key = parsed.pathname.split('/').slice(-2).join('/');
    return new Response(Uint8Array.from(uploads.get(key)!));
  });
  await using _cleanup1 = onAsyncExit(() => acquired.release());
  assert.equal(
    await fs.readFile(path.join(acquired.root, 'public/authoring-only.png'), 'utf8'),
    'distinct authoring artwork',
  );
});

test('authoring shards preserve unrelated membership and retain indivisible sources', () => {
  const inventory = Object.fromEntries(
    Array.from({ length: 1000 }, (_, i) => ['public/art/' + i + '.png', { bytes: 100 }]),
  );
  const before = authoringGroups(Object.keys(inventory), inventory, 1000);
  const deleted = Object.keys(inventory)[0]!;
  const after = authoringGroups(
    Object.keys(inventory).filter((file) => file !== deleted),
    inventory,
    1000,
  );
  for (const [name, files] of before) {
    assert.ok(files.reduce((sum, file) => sum + inventory[file]!.bytes, 0) <= 1000);
    if (!files.includes(deleted) && after.has(name)) assert.deepEqual(after.get(name), files);
  }
  assert.deepEqual(
    [...after.values()].flat().sort(),
    Object.keys(inventory)
      .filter((file) => file !== deleted)
      .sort(),
  );
  assert.deepEqual(
    [...authoringGroups(['huge'], { huge: { bytes: 1001 } }, 1000).values()],
    [['huge']],
  );
});

test('remote reuse requires previously hashed bytes and a strong validator; changed responses still fail hashing', async (t) => {
  const root = await temporaryDirectory(t, 'remote-bundle-proof-');
  const cache = new AssetCache(root);
  const body = 'immutable bundle';
  const sha256 = createHash('sha256').update(body).digest('hex');
  const lock: AssetLock = {
    schemaVersion: 1,
    releaseTag: 'assets-' + sha256.slice(0, 16),
    filename: 'lantern-assets.tar.gz',
    sha256,
    bytes: Buffer.byteLength(body),
    inventorySha256: 'a'.repeat(64),
    recipeSha256: 'b'.repeat(64),
  };
  let calls = 0;
  const request: typeof fetch = async (_, init) => {
    calls++;
    const validator = new Headers(init?.headers).get('If-None-Match');
    if (calls === 1) {
      assert.equal(validator, null);
      return new Response(body, { headers: { etag: '"exact-bytes"' } });
    }
    assert.equal(validator, '"exact-bytes"');
    return calls === 2
      ? new Response(null, { status: 304, headers: { etag: '"exact-bytes"' } })
      : new Response('corrupt bytes', { headers: { etag: '"changed"' } });
  };

  await verifyRemote(lock, cache, request);
  await verifyRemote(lock, cache, request);
  await assert.rejects(verifyRemote(lock, cache, request), /hash differs/);
  assert.equal(calls, 3);
  let weak304Calls = 0;
  await verifyRemote(lock, cache, async (_, init) => {
    weak304Calls++;
    if (new Headers(init?.headers).has('If-None-Match'))
      return new Response(null, { status: 304, headers: { etag: 'W/"exact-bytes"' } });
    return new Response(body, { headers: { etag: 'W/"semantic-only"' } });
  });
  assert.equal(weak304Calls, 2);
  const weak: typeof fetch = async (_, init) => {
    assert.equal(new Headers(init?.headers).get('If-None-Match'), null);
    return new Response(body, { headers: { etag: 'W/"semantic-only"' } });
  };
  await fs.rm(path.join(root, 'entries', 'publication-' + sha256, 'verified.json'), {
    force: true,
  });
  await verifyRemote(lock, cache, weak);
  await verifyRemote(lock, cache, weak);
});
