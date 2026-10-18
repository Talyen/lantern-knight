import { onAsyncExit, onExit } from '../../tools/scope-exit';
import { writeJson, readJson } from '../../tools/json-file';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from '../../tools/assets/files';
import * as tar from 'tar';
import { AssetCache, diskBytes } from '../../tools/assets/cache';
import {
  ensurePack,
  inspectArchive,
  validatePack,
  validateCachedPack,
  installMatchingPreparation,
  preparationPin,
  recipeHash,
  recipeInputs,
  LockSchema,
} from '../../tools/assets/pack';
import { ensureBundlePack } from '../../tools/assets/bundles';
import { makeArchive, inventoryCandidate } from '../../tools/assets/archive';

import { projectRoot } from '../../tools/assets/paths';
import { prototypeAssets } from '../../tools/assets/preview';
import { workspaceIdentity } from '../../tools/assets/workspace';

test('recipe identity includes producers and excludes runtime composition and delivery tooling', async () => {
  // Each variant changes one input in the same immutable source snapshot.
  const inputs = new Map<string, Promise<Buffer<ArrayBuffer>>>();
  const read = (name: string) => {
    if (!inputs.has(name)) inputs.set(name, fs.readFile(path.join(projectRoot, name)));
    return inputs.get(name)!;
  };
  const before = await recipeHash(read);
  for (const file of [
    'src/content/developer-scenes.ts',
    'src/content/game-content.ts',
    'src/content/crypt-scene.ts',
    'src/content/polygon.ts',
    'src/content/camera.json',
    'src/presentation/lighting-profiles.ts',
    'tools/assets/prepare/prepare-ground-proof.ts',
    'src/content/visuals.ts',
    'tools/run-process.ts',
    'tools/assets/pack.ts',
    'tools/assets/paths.ts',
    'tools/assets/bundles.ts',
    'tools/assets/publication.ts',
    'tools/assets/file-publication.ts',
  ]) {
    assert.equal(
      await recipeHash((name) =>
        name === file ? Promise.resolve(Buffer.from('changed runtime composition')) : read(name),
      ),
      before,
      file,
    );
  }
  for (const file of [
    'src/content/asset-catalog.ts',
    'src/content/visual-effects-assets.ts',
    'src/assets/camera.json',
    'src/assets/normal-pixels.ts',
    'authoring/ground-overlays.json',
    'authoring/hero-actions.json',
    'tools/assets/prepare/prepare-graveyard-coverage.ts',
    'tools/assets/prepare.ts',
  ]) {
    assert.notEqual(
      await recipeHash((name) =>
        name === file ? Promise.resolve(Buffer.from('changed authoring input')) : read(name),
      ),
      before,
      file,
    );
  }
});

async function fixture(t: TestContext) {
  const root = await temporaryDirectory(t, 'lantern-packs-'),
    source = path.join(root, 'source'),
    archive = path.join(root, 'pack.tar.gz');
  await fs.mkdir(path.join(source, 'public'), { recursive: true });
  await fs.mkdir(path.join(source, 'metadata'));
  await fs.writeFile(path.join(source, 'public/page.png'), 'unchanged texture');
  await fs.link(path.join(source, 'public/page.png'), path.join(source, 'public/native.png'));
  await fs.writeFile(path.join(source, 'metadata/receipt.json'), '{}');
  const lock = await makeArchive(source, archive, 'a'.repeat(64)),
    body = await fs.readFile(archive),
    cache = new AssetCache(path.join(root, 'cache'), 256 * 1024);
  return {
    root,
    source,
    archive,
    lock,
    body,
    cache,
  };
}
test('prepared archives are deterministic; fresh downloads verify every file and work offline', async (t) => {
  const f = await fixture(t);

  const second = path.join(f.root, 'second.tar.gz');
  assert.deepEqual(await makeArchive(f.source, second, f.lock.recipeSha256), f.lock);
  assert.deepEqual(await fs.readFile(second), f.body);
  let downloads = 0;
  const request = (async () => {
    downloads++;
    return new Response(f.body);
  }) as typeof fetch;
  const held = await ensurePack(f.lock, f.cache, request);
  await validatePack(held.root, f.lock);
  assert.equal(
    await fs.readFile(path.join(held.root, 'public/native.png'), 'utf8'),
    'unchanged texture',
  );
  await held.release();
  const offline = await ensurePack(f.lock, f.cache, (async () => {
    throw new Error('offline');
  }) as typeof fetch);
  assert.equal(downloads, 1);
  await offline.release();
});
test('an evicted local layer falls back to the pin while a corrupt descriptor still fails', async (t) => {
  const f = await fixture(t);

  await fs.mkdir(path.join(f.root, 'assets'));
  await writeJson(path.join(f.root, 'assets/lock.json'), f.lock);
  const pinned = await ensurePack(
    f.lock,
    f.cache,
    (async () => new Response(f.body)) as typeof fetch,
  );
  await pinned.release();
  const prefix =
    'preview-' + createHash('sha256').update(path.resolve(f.root)).digest('hex').slice(0, 20);
  const entry = prefix + '-' + '0'.repeat(24);
  const index = await f.cache.lease(prefix + '-index');
  await writeJson(path.join(index.root, 'preview.json'), { entry });
  await index.release();
  const restored = await prototypeAssets(f.cache, f.root);
  assert.equal(restored.lock.sha256, f.lock.sha256);
  assert.equal(
    await fs.readFile(path.join(restored.held.root, 'public/page.png'), 'utf8'),
    'unchanged texture',
  );
  await restored.held.release();
  const corrupt = await f.cache.lease(entry);
  await fs.writeFile(path.join(corrupt.root, 'preview.json'), '{');
  await corrupt.release();
  await assert.rejects(prototypeAssets(f.cache, f.root), SyntaxError);
});
test('a checkout can select verified shared preparation without reverting to its pin', async (t) => {
  const f = await fixture(t),
    entry = 'preview-' + 'a'.repeat(20) + '-' + 'b'.repeat(24),
    prepared = await f.cache.lease(entry),
    sha256 = 'c'.repeat(64),
    prefix = (root: string) =>
      'preview-' + createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 20);
  const priorCache = process.env.LANTERN_CACHE_ROOT;
  await using _scopeExit5 = onAsyncExit(async () => {
    if (priorCache === undefined) delete process.env.LANTERN_CACHE_ROOT;
    else process.env.LANTERN_CACHE_ROOT = priorCache;
    await prepared.release();
  });
  await fs.mkdir(path.join(prepared.root, 'work/public'), { recursive: true });
  const bytes = 'calibrated hero';
  await fs.writeFile(path.join(prepared.root, 'work/public/hero.json'), bytes);
  await writeJson(path.join(prepared.root, 'preview.json'), {
    version: 1,
    sha256,
    recipeSha256: f.lock.recipeSha256,
    files: { 'public/hero.json': createHash('sha256').update(bytes).digest('hex') },
  });
  for (const root of [f.root, projectRoot]) {
    const index = await f.cache.lease(prefix(root) + '-index');
    await using _cleanup1 = onAsyncExit(() => index.release());
    await writeJson(path.join(index.root, 'preview.json'), { entry });
  }
  const selected = await prototypeAssets(f.cache, f.root);
  try {
    assert.equal(selected.lock.sha256, sha256);
    assert.equal(
      await fs.readFile(path.join(selected.held.root, 'public/hero.json'), 'utf8'),
      bytes,
    );
  } finally {
    await selected.held.release();
  }
  process.env.LANTERN_CACHE_ROOT = f.cache.root;
  assert.equal(await workspaceIdentity('local'), sha256);
});
test('corrupt caches are repaired by pinned bytes; active users are protected', async (t) => {
  const f = await fixture(t);

  const request = (async () => new Response(f.body)) as typeof fetch,
    held = await ensurePack(f.lock, f.cache, request);
  await fs.writeFile(path.join(held.root, 'public/page.png'), 'tampered');
  await assert.rejects(ensurePack(f.lock, f.cache, request), /in use/);
  await held.release();
  const repaired = await ensurePack(f.lock, f.cache, request);
  assert.equal(
    await fs.readFile(path.join(repaired.root, 'public/page.png'), 'utf8'),
    'unchanged texture',
  );
  await repaired.release();
});

test('warm pack validation still checks each accepted payload identity', async (t) => {
  const f = await fixture(t);

  const held = await ensurePack(
    f.lock,
    f.cache,
    (async () => new Response(f.body)) as typeof fetch,
  );
  await using _cleanup2 = onAsyncExit(() => held.release());
  const pin = preparationPin(f.lock, {}, await validatePack(held.root, f.lock));
  await validateCachedPack(held.root, pin);
  assert.notEqual(pin.schemaVersion, 1);
  if (pin.schemaVersion !== 1)
    await assert.rejects(
      validateCachedPack(held.root, {
        ...pin,
        preparation: { ...pin.preparation, payloadSha256: '0'.repeat(64) },
      }),
      /Accepted preparation payload differs/,
    );
});
test('exact pinned preparation can be consumed offline and survives preparation cleanup', async (t) => {
  const f = await fixture(t);

  const preparation = await f.cache.lease('preparation'),
    payload = path.join(preparation.root, 'work/payload');
  await fs.mkdir(path.dirname(payload), { recursive: true });
  await fs.cp(f.source, payload, { recursive: true });
  await writeJson(path.join(preparation.root, 'prepared.json'), f.lock);
  const held = await ensurePack(f.lock, f.cache, (async () => {
    throw new Error('Unexpected download');
  }) as typeof fetch);
  const inventory = await validatePack(held.root, f.lock);
  const pin = LockSchema.parse({
    ...preparationPin(f.lock, await recipeInputs(), inventory),
    schemaVersion: 3,
    bundles: { runtime: f.lock },
  });
  if (pin.schemaVersion !== 3) throw new Error('Expected bundled pin');
  const bundled = await ensureBundlePack(pin, f.cache, async () => {
    throw new Error('Unexpected authoring download');
  });
  await fs.rm(payload, { recursive: true, force: true });
  await validatePack(held.root, f.lock);
  await validateCachedPack(bundled.root, pin);
  await bundled.release();
  await held.release();
  await preparation.release();
});
test('a cached preparation proof cannot seed changed bytes with the same size and modification time', async (t) => {
  const f = await fixture(t);
  const preparation = await f.cache.lease('preparation'),
    destination = await f.cache.lease('destination'),
    payload = path.join(preparation.root, 'work/payload');
  await using _cleanup = onAsyncExit(async () => {
    await destination.release();
    await preparation.release();
  });
  await fs.mkdir(path.dirname(payload), { recursive: true });
  await fs.cp(f.source, payload, { recursive: true });
  await writeJson(path.join(preparation.root, 'prepared.json'), f.lock);
  await validateCachedPack(payload, f.lock);
  const file = path.join(payload, 'public/page.png'),
    before = await fs.stat(file);
  await fs.writeFile(file, Buffer.alloc(before.size, 0x78));
  await fs.utimes(file, before.atime, before.mtime);
  assert.equal(await installMatchingPreparation(destination, f.lock, f.cache), false);
  await assert.rejects(fs.access(path.join(destination.root, 'public/page.png')), {
    code: 'ENOENT',
  });
});
test('a rewritten cache inventory cannot bless changed asset bytes', async (t) => {
  const f = await fixture(t);

  const held = await ensurePack(
    f.lock,
    f.cache,
    (async () => new Response(f.body)) as typeof fetch,
  );
  const file = path.join(held.root, 'pack.json'),
    data = await readJson(file);
  data.files['public/page.png'].bytes = 1;
  await writeJson(file, data);
  await assert.rejects(validatePack(held.root, f.lock), /inventory hash/);
  await held.release();
});
test('bad and interrupted downloads do not become usable packs or leave partial payloads', async (t) => {
  const f = await fixture(t);

  for (const request of [
    (async () => new Response('wrong bytes')) as typeof fetch,
    (async () => new Response(null, { status: 404 })) as typeof fetch,
    (async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array([1]));
            c.error(new Error('interrupted'));
          },
        }),
      )) as typeof fetch,
  ])
    await assert.rejects(ensurePack(f.lock, f.cache, request));
  const entry = path.join(f.cache.root, 'entries', 'pack-' + f.lock.sha256);
  assert.equal(
    (await fs.readdir(entry)).filter((n) => n.startsWith('.download') || n.startsWith('.incoming'))
      .length,
    0,
  );
  await assert.rejects(fs.access(path.join(entry, 'pack.json')));
});
test('archive links, traversal and oversized extraction are rejected before installation', async (t) => {
  const f = await fixture(t);

  await assert.rejects(inspectArchive(f.archive, 1), /budget/);
  await fs.symlink(path.join(f.root, 'outside'), path.join(f.source, 'public/link'));
  const bad = path.join(f.root, 'link.tar.gz');
  await tar.c({ cwd: f.source, file: bad }, ['public/link', 'pack.json']);
  await assert.rejects(inspectArchive(bad), /links/);
  for (const name of ['../escape', '/absolute', 'C:/drive', 'public/../escape', 'public\\escape'])
    assert.throws(() => safeRelative(name));
});
test('cache reservations evict unused data, protect active work and enforce the total budget', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-budget-'),
    cache = new AssetCache(root, 8192);

  const old = await cache.lease('old', 3000);
  await fs.writeFile(path.join(old.root, 'data'), Buffer.alloc(3000));
  await old.release();
  const active = await cache.lease('active', 3000);
  await fs.writeFile(path.join(active.root, 'data'), Buffer.alloc(3000));
  const next = await cache.lease('next', 4000);
  await assert.rejects(fs.access(old.root));
  await assert.rejects(cache.lease('too-big', 9000), /budget/);
  await assert.rejects(next.reserve(6000), /protected/);
  for (const bytes of [NaN, Infinity, -1, 1.5]) {
    await assert.rejects(next.reserve(bytes), /reservation/);
    await assert.rejects(cache.reserve('next', bytes), /reservation/);
  }
  await assert.rejects(cache.lease('active', 0, true), /in use/);
  assert.ok((await cache.usage()) <= 8192);
  await cache.clean();
  await fs.access(active.root);
  await fs.access(next.root);
  await next.release();
  await active.release();
  await cache.clean();
  assert.ok((await diskBytes(root)) < 8192);
});
for (const operation of ['reserve', 'reserveUpTo'] as const)
  test(`a queued ${operation} cannot recreate a released cache lease`, async (t) => {
    const root = await temporaryDirectory(t, 'lantern-lease-release-');
    const cache = new AssetCache(root, 8192);
    const held = await cache.lease('active');
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const mkdir = fs.mkdir;
    let paused = false;
    t.mock.method(fs, 'mkdir', async (...args: Parameters<typeof mkdir>) => {
      if (args[0] === path.join(root, '.mutex') && !paused) {
        paused = true;
        entered.resolve();
        await resume.promise;
      }
      return mkdir(...args);
    });
    t.after(() => resume.resolve());
    const reservation = assert.rejects(
      operation === 'reserve' ? held.reserve(1000) : held.reserveUpTo(1000, 2000),
      /reservation/,
    );
    await entered.promise;
    await held.release();
    resume.resolve();
    await reservation;
    assert.deepEqual(await fs.readdir(path.join(held.root, '.leases')), []);
    assert.equal(await cache.clean(), 1, 'released entry must remain evictable');
  });
test('failed lease metadata writes preserve live reservations and do not wedge subsequent cache operations', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-lease-write-'),
    cache = new AssetCache(root, 8192),
    held = await cache.lease('active', 3000),
    directory = path.join(held.root, '.leases'),
    file = path.join(directory, (await fs.readdir(directory))[0]!),
    before = await fs.readFile(file, 'utf8'),
    write = fs.writeFile;
  const failWrite = () => {
    fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => {
      if (typeof args[0] === 'string' && args[0].includes(path.sep + '.leases' + path.sep)) {
        await write(args[0], '{"pid":');
        throw new Error('disk full during lease write');
      }
      return write(...args);
    };
  };
  await using _scopeExit3 = onAsyncExit(async () => {
    fs.writeFile = write;
    await held.release();
  });
  failWrite();
  try {
    await assert.rejects(held.reserve(4000), /disk full/);
  } finally {
    fs.writeFile = write;
  }
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await assert.rejects(cache.lease('cannot-fit', 6000), /protected/);
  failWrite();
  try {
    await assert.rejects(cache.lease('failed'), /disk full/);
  } finally {
    fs.writeFile = write;
  }
  assert.ok((await cache.usage()) <= 8192);
  await fs.writeFile(path.join(directory, 'abandoned.json.tmp'), '{"pid":');
  assert.equal(await held.sole(), true);
  await assert.rejects(fs.access(path.join(directory, 'abandoned.json.tmp')));
  const peer = await cache.lease('active');
  assert.equal(await held.sole(), false);
  await peer.release();
  const next = await cache.lease('next', 1000);
  await next.release();
});
test('failed initial cache ownership publication leaves the directory recoverable and still rejects unrelated files', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-owner-write-'),
    cache = new AssetCache(root, 8192),
    write = fs.writeFile;
  using _scopeExit4 = onExit(() => {
    fs.writeFile = write;
  });
  fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => {
    if (typeof args[0] === 'string' && args[0].includes('.cache-owner')) {
      await write(args[0], '{"schemaVersion":');
      throw new Error('disk full during owner write');
    }
    return write(...args);
  };
  try {
    await assert.rejects(cache.lease('first'), /disk full/);
  } finally {
    fs.writeFile = write;
  }
  await assert.rejects(fs.access(path.join(root, '.cache-owner.json')));
  await fs.writeFile(path.join(root, '.cache-owner-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.tmp'), '{');
  await fs.writeFile(path.join(root, 'unrelated.txt'), 'preserve this');
  await assert.rejects(cache.lease('next'), /unrelated/);
  assert.equal(await fs.readFile(path.join(root, 'unrelated.txt'), 'utf8'), 'preserve this');
  await fs.rm(path.join(root, 'unrelated.txt'));
  const held = await cache.lease('next');
  await held.release();
});

test('equivalence excludes only preparation provenance and binds the accepted recipe to unchanged archive bytes', async (t) => {
  const { payloadDigest, preparationPin, LockSchema, acceptedRecipe } =
    await import('../../tools/assets/pack');
  const { recipeInputs } = await import('../../tools/assets/recipe');
  const root = await temporaryDirectory(t, 'lantern-equivalence-');

  const payload = path.join(root, 'payload');
  await fs.mkdir(path.join(payload, 'public'), { recursive: true });
  await fs.mkdir(path.join(payload, 'metadata'));
  await fs.writeFile(path.join(payload, 'public/pixels.png'), 'pixels');
  await fs.writeFile(path.join(payload, 'metadata/preparation-inputs.json'), 'old recipe');
  const lock = await makeArchive(payload, path.join(root, 'pack.tar.gz'), 'a'.repeat(64)),
    before = await validatePack(payload, lock);
  const inputs = await recipeInputs(),
    pin = preparationPin(lock, inputs, before);
  assert.equal(pin.sha256, lock.sha256);
  assert.equal(pin.recipeSha256, lock.recipeSha256);
  assert.equal(acceptedRecipe(pin), await recipeHash());
  assert.deepEqual(await validatePack(payload, pin), before);
  const changed = structuredClone(before);
  changed.files['metadata/preparation-inputs.json'] = { bytes: 100, sha256: 'b'.repeat(64) };
  assert.equal(payloadDigest(changed), payloadDigest(before));
  changed.files['public/pixels.png']!.sha256 = 'c'.repeat(64);
  assert.notEqual(payloadDigest(changed), payloadDigest(before));
  delete changed.files['public/pixels.png'];
  assert.notEqual(payloadDigest(changed), payloadDigest(before));
  changed.files['metadata/new-receipt.json'] = { bytes: 1, sha256: 'd'.repeat(64) };
  assert.notEqual(payloadDigest(changed), payloadDigest(before));
  assert.throws(
    () =>
      LockSchema.parse({
        ...pin,
        preparation: {
          ...(pin.schemaVersion === 2 ? pin.preparation : {}),
          recipeSha256: 'f'.repeat(64),
        },
      }),
    /Accepted preparation/,
  );
  await fs.writeFile(path.join(payload, 'public/pixels.png'), 'tampered');
  await assert.rejects(validatePack(payload, pin), /differs/);
});

test('loading media rejects missing, truncated and changed selected source bytes', async () => {
  const { validateLoadingVideo } = await import('../../tools/assets/loading-media');
  assert.throws(() => validateLoadingVideo(new Uint8Array()), /differs/);
  assert.throws(() => validateLoadingVideo(new Uint8Array(625991)), /differs/);
  assert.throws(() => validateLoadingVideo(new Uint8Array(625992)), /differs/);
});

test('eviction does not subtract shared files retained by active cache entries', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-shared-cache-');
  const cache = new AssetCache(root, 8192);

  const old = await cache.lease('a-old');
  await fs.writeFile(path.join(old.root, 'shared'), Buffer.alloc(5000));
  await old.release();
  const live = await cache.lease('z-live');
  await fs.link(path.join(old.root, 'shared'), path.join(live.root, 'shared'));
  await assert.rejects(cache.lease('next', 4000), /protected/);
  await fs.access(path.join(live.root, 'shared'));
  assert.ok((await cache.usage()) >= 5000);
  await live.release();
});

test('preview pruning preserves active readers, the current layer and other checkouts', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-preview-prune-');
  const cache = new AssetCache(root);
  const prefix = 'preview-' + 'a'.repeat(20);
  const old = await cache.lease(prefix + '-old');
  const current = await cache.lease(prefix + '-current');
  const active = await cache.lease(prefix + '-active');
  const peer = await cache.lease('preview-' + 'b'.repeat(20) + '-old');
  await using _scopeExit2 = onAsyncExit(async () => {
    await active.release();
    await old.release();
    await current.release();
    await peer.release();
  });
  await old.release();
  await current.release();
  await peer.release();
  const index = await cache.lease(prefix + '-index');
  await cache.prunePreviews(prefix, prefix + '-current');
  await fs.access(old.root);
  await index.release();
  await cache.prunePreviews(prefix, prefix + '-current');
  await assert.rejects(fs.access(old.root), { code: 'ENOENT' });
  await Promise.all([current, active, peer].map((held) => fs.access(held.root)));
  await active.release();
  await cache.prunePreviews(prefix, prefix + '-current');
  await assert.rejects(fs.access(active.root), { code: 'ENOENT' });
});

test('growth reservations grant bounded headroom near a full cache and protect active readers', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-growth-');
  const cache = new AssetCache(root, 16384);
  const active = await cache.lease('reader');
  const writer = await cache.lease('writer');
  await using _scopeExit1 = onAsyncExit(async () => {
    await active.release();
    await writer.release();
  });
  await fs.writeFile(path.join(active.root, 'data'), Buffer.alloc(10000));
  const granted = await writer.reserveUpTo(1000, 256 * 1024 ** 2);
  assert.ok(granted > 1000 && granted < 6384);
  await fs.writeFile(path.join(writer.root, 'data'), Buffer.alloc(granted - 512));
  assert.ok((await cache.usage()) <= cache.limit);
  await assert.rejects(writer.reserveUpTo(8000, 9000), /protected/);
  await fs.access(path.join(active.root, 'data'));
});

test('single-pass installation rejects archive links and releases its peak reservation', async (t) => {
  const f = await fixture(t);

  const installed = await ensurePack(
    f.lock,
    f.cache,
    (async () => new Response(f.body)) as typeof fetch,
  );
  const leases = await fs.readdir(path.join(installed.root, '.leases'));
  const owner = await readJson(path.join(installed.root, '.leases', leases[0]!));
  assert.equal(owner.bytes, 0, 'completed downloads retain no temporary reservation');
  await installed.release();
  await fs.symlink('page.png', path.join(f.source, 'public/link.png'));
  const archive = path.join(f.root, 'link.tar.gz');
  await tar.c({ cwd: f.source, file: archive, gzip: true }, ['pack.json', 'public/link.png']);
  const body = await fs.readFile(archive);
  const lock = {
    ...f.lock,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: body.length,
  };
  await assert.rejects(
    ensurePack(lock, f.cache, (async () => new Response(body)) as typeof fetch),
    /links and special entries/,
  );
});

test('offline preparation seeding reserves metadata rather than a second copy of hardlinked payload bytes', async (t) => {
  const root = await temporaryDirectory(t, 'preparation-link-budget-');
  const cache = new AssetCache(root, 320 * 1024);
  const preparation = await cache.lease('preparation');
  const destination = await cache.lease('destination');
  await using _cleanup = onAsyncExit(async () => {
    await destination.release();
    await preparation.release();
  });
  const payload = path.join(preparation.root, 'work/payload');
  await fs.mkdir(path.join(payload, 'public'), { recursive: true });
  await fs.mkdir(path.join(payload, 'metadata'));
  await fs.writeFile(path.join(payload, 'metadata/receipt.json'), '{}');
  await fs.writeFile(path.join(payload, 'public/large.png'), Buffer.alloc(192 * 1024, 0x41));
  const lock = await inventoryCandidate(payload, 'a'.repeat(64));
  await writeJson(path.join(preparation.root, 'prepared.json'), lock);
  assert.equal(await installMatchingPreparation(destination, lock, cache), true);
  const source = await fs.stat(path.join(payload, 'public/large.png'));
  const linked = await fs.stat(path.join(destination.root, 'public/large.png'));
  assert.equal(linked.ino, source.ino);
  assert.equal(linked.dev, source.dev);
  await validateCachedPack(destination.root, lock);
  assert.ok((await diskBytes(root)) < cache.limit);
});

test('incremental cache inventory skips unchanged payload walks across instances and evictions', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-cache-inventory-');
  const cache = new AssetCache(root, 16384);
  for (const name of ['old-a', 'old-b', 'retained']) {
    const held = await cache.lease(name, 3000);
    await fs.mkdir(path.join(held.root, 'nested'));
    await fs.writeFile(path.join(held.root, 'nested/data'), Buffer.alloc(3000));
    await held.release();
  }
  const read = fs.readdir;
  const walks: string[] = [];
  t.mock.method(fs, 'readdir', async (...args: Parameters<typeof read>) => {
    const name = String(args[0]);
    if (name.includes('/entries/') && !name.endsWith('/.leases')) walks.push(name);
    return read(...args);
  });
  const fresh = new AssetCache(root, 16384);
  const reader = await fresh.lease('retained', 0, false, true);
  await fresh.usage();
  assert.ok((await reader.residentBytes()) >= 3000);
  const writer = await fresh.lease('new', 11000);
  assert.deepEqual(walks, [], 'inactive and read-only payloads reuse persisted inode inventories');
  await assert.rejects(fs.access(path.join(root, 'entries/old-a')));
  await assert.rejects(fs.access(path.join(root, 'entries/old-b')));
  await fs.access(path.join(reader.root, 'nested/data'));
  await writer.release();
  await reader.release();
});

test('cache inventory rebuilds corrupt records and refreshes mutable entries without stale sizes', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-cache-inventory-repair-');
  const cache = new AssetCache(root, 16384);
  const held = await cache.lease('data', 3000);
  await fs.mkdir(path.join(held.root, 'nested'));
  await fs.writeFile(path.join(held.root, 'nested/data'), Buffer.alloc(3000));
  await held.release();
  await fs.writeFile(path.join(root, '.inventory/data.json.gz'), 'corrupt inventory');
  assert.ok((await cache.usage()) >= 3000);
  const writer = await cache.lease('data');
  await fs.writeFile(path.join(writer.root, 'nested/data'), Buffer.alloc(8000));
  assert.ok(
    (await cache.usage()) >= 8000,
    'an active writer is accounted from current filesystem data',
  );
  await writer.release();
  assert.ok((await new AssetCache(root, 16384).usage()) >= 8000);
});

test('inventory storage exhaustion preserves lease cleanup and falls back to filesystem accounting', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-cache-index-space-');
  const cache = new AssetCache(root, 16384);
  const held = await cache.lease('data', 3000);
  await fs.writeFile(path.join(held.root, 'data'), Buffer.alloc(3000));
  const write = fs.writeFile;
  const mocked = t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof write>) => {
    if (typeof args[0] === 'string' && args[0].includes('/.inventory/'))
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return write(...args);
  });
  await held.release();
  assert.deepEqual(await fs.readdir(path.join(held.root, '.leases')), []);
  assert.ok((await cache.usage()) >= 3000);
  mocked.mock.restore();
  assert.ok((await cache.usage()) >= 3000);
});

test('local demand readers verify only requested bytes and revoke access before releasing their lease', async (t) => {
  const f = await fixture(t);
  const prefix =
    'preview-' + createHash('sha256').update(path.resolve(f.root)).digest('hex').slice(0, 20);
  const entry = prefix + '-' + 'd'.repeat(24);
  const prepared = await f.cache.lease(entry);
  await fs.mkdir(path.join(prepared.root, 'work/public'), { recursive: true });
  const bytes = 'selected metadata';
  const file = path.join(prepared.root, 'work/public/selected.json');
  await fs.writeFile(file, bytes);
  await writeJson(path.join(prepared.root, 'preview.json'), {
    version: 1,
    sha256: 'a'.repeat(64),
    recipeSha256: f.lock.recipeSha256,
    files: {
      'public/selected.json': createHash('sha256').update(bytes).digest('hex'),
      'public/unrequested.png': 'b'.repeat(64),
    },
  });
  await prepared.release();
  const index = await f.cache.lease(prefix + '-index');
  await writeJson(path.join(index.root, 'preview.json'), { entry });
  await index.release();
  const selected = await prototypeAssets(f.cache, f.root, 'authoring', false, undefined, true);
  const ensure = 'ensurePublicFile' in selected.held && selected.held.ensurePublicFile;
  assert.ok(ensure);
  assert.equal(await ensure('selected.json'), true);
  assert.equal(await ensure('constructor'), false);
  await assert.rejects(ensure('unrequested.png'), { code: 'ENOENT' });
  const before = await fs.stat(file);
  await fs.writeFile(file, 'tampered metadata');
  await fs.utimes(file, before.atime, before.mtime);
  await assert.rejects(ensure('selected.json'), /output changed/);
  await fs.writeFile(file, bytes);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const lstat = fs.lstat;
  let waiting = true;
  t.mock.method(fs, 'lstat', async (...args: Parameters<typeof lstat>) => {
    if (String(args[0]) === file && waiting) {
      waiting = false;
      started.resolve();
      await finish.promise;
    }
    return lstat(...args);
  });
  const read = ensure('selected.json');
  assert.equal(ensure('selected.json'), read);
  await started.promise;
  const closing = selected.held.release();
  await assert.rejects(ensure('selected.json'), /released/);
  assert.equal((await fs.readdir(path.join(prepared.root, '.leases'))).length, 1);
  finish.resolve();
  assert.equal(await read, true);
  await closing;
  assert.deepEqual(await fs.readdir(path.join(prepared.root, '.leases')), []);
});

test('read leases preserve the inode inventory and update eviction recency through lease metadata', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-cache-read-recency-');
  const cache = new AssetCache(root, 16384);
  for (const name of ['recently-read', 'unused']) {
    const held = await cache.lease(name, 4000);
    await fs.writeFile(path.join(held.root, 'data'), Buffer.alloc(4000));
    await held.release();
    for (const file of [held.root, path.join(held.root, '.leases')])
      await fs.utimes(file, new Date(0), new Date(0));
  }
  // Account after the deliberate timestamp changes, then freeze the record.
  await cache.usage();
  const inventory = path.join(root, '.inventory/recently-read.json.gz');
  const before = await fs.readFile(inventory);
  const stat = await fs.stat(inventory);
  const reader = await new AssetCache(root, cache.limit).lease('recently-read', 0, false, true);
  await reader.release();
  assert.deepEqual(await fs.readFile(inventory), before);
  assert.equal((await fs.stat(inventory)).mtimeMs, stat.mtimeMs);
  const growth = await cache.lease('new', 10000);
  await fs.access(path.join(root, 'entries/recently-read/data'));
  await assert.rejects(fs.access(path.join(root, 'entries/unused')), { code: 'ENOENT' });
  await growth.release();
});
