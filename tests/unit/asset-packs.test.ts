import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import { AssetCache, diskBytes } from '../../tools/assets/cache';
import {
  ensurePack,
  inspectArchive,
  validatePack,
  validateCachedPack,
  preparationPin,
  recipeHash,
} from '../../tools/assets/pack';
import { makeArchive } from '../../tools/assets/archive';

import { safeRelative } from '../../tools/assets/paths';
import { projectRoot } from '../../tools/assets/paths';

test('runtime composition and lighting do not invalidate artwork, but bake inputs still do', async () => {
  const read = (name: string) => fs.readFile(path.join(projectRoot, name));
  const before = await recipeHash(read);
  for (const file of [
    'src/content/developer-scenes.ts',
    'src/content/crypt-scene.ts',
    'src/content/graveyard-layout.ts',
    'src/content/camera.json',
    'src/presentation/lighting-profiles.ts',
    'tools/assets/prepare/prepare-ground-proof.ts',
    'src/content/visuals.ts',
    'tools/run-process.ts',
    'tools/assets/pack.ts',
    'tools/assets/prepare.ts',
    'tools/assets/paths.ts',
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

let fixtureRecipe: Promise<string> | undefined;
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-packs-')),
    source = path.join(root, 'source'),
    archive = path.join(root, 'pack.tar.gz');
  await fs.mkdir(path.join(source, 'public'), { recursive: true });
  await fs.mkdir(path.join(source, 'metadata'));
  await fs.writeFile(path.join(source, 'public/page.png'), 'unchanged texture');
  await fs.writeFile(path.join(source, 'metadata/receipt.json'), '{}');
  const lock = await makeArchive(source, archive, await (fixtureRecipe ??= recipeHash())),
    body = await fs.readFile(archive),
    cache = new AssetCache(path.join(root, 'cache'), 256 * 1024);
  return {
    root,
    source,
    archive,
    lock,
    body,
    cache,
    close: () => fs.rm(root, { recursive: true, force: true }),
  };
}
test('prepared archives are deterministic; fresh downloads verify every file and work offline', async () => {
  const f = await fixture();
  try {
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
    await held.release();
    const offline = await ensurePack(f.lock, f.cache, (async () => {
      throw new Error('offline');
    }) as typeof fetch);
    assert.equal(downloads, 1);
    await offline.release();
  } finally {
    await f.close();
  }
});
test('corrupt caches are repaired by pinned bytes; active users are protected', async () => {
  const f = await fixture();
  try {
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
  } finally {
    await f.close();
  }
});

test('warm pack validation still checks each accepted payload identity', async () => {
  const f = await fixture();
  try {
    const held = await ensurePack(
      f.lock,
      f.cache,
      (async () => new Response(f.body)) as typeof fetch,
    );
    try {
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
    } finally {
      await held.release();
    }
  } finally {
    await f.close();
  }
});
test('exact pinned preparation can be consumed offline and survives preparation cleanup', async () => {
  const f = await fixture();
  try {
    const preparation = await f.cache.lease('preparation'),
      payload = path.join(preparation.root, 'work/payload');
    await fs.mkdir(path.dirname(payload), { recursive: true });
    await fs.cp(f.source, payload, { recursive: true });
    await fs.writeFile(path.join(preparation.root, 'prepared.json'), JSON.stringify(f.lock));
    const held = await ensurePack(f.lock, f.cache, (async () => {
      throw new Error('Unexpected download');
    }) as typeof fetch);
    await validatePack(held.root, f.lock);
    await fs.rm(payload, { recursive: true, force: true });
    await validatePack(held.root, f.lock);
    await held.release();
    await preparation.release();
  } finally {
    await f.close();
  }
});
test('a rewritten cache inventory cannot bless changed asset bytes', async () => {
  const f = await fixture();
  try {
    const held = await ensurePack(
      f.lock,
      f.cache,
      (async () => new Response(f.body)) as typeof fetch,
    );
    const file = path.join(held.root, 'pack.json'),
      data = JSON.parse(await fs.readFile(file, 'utf8'));
    data.files['public/page.png'].bytes = 1;
    await fs.writeFile(file, JSON.stringify(data));
    await assert.rejects(validatePack(held.root, f.lock), /inventory hash/);
    await held.release();
  } finally {
    await f.close();
  }
});
test('bad and interrupted downloads do not become usable packs or leave partial payloads', async () => {
  const f = await fixture();
  try {
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
      (await fs.readdir(entry)).filter(
        (n) => n.startsWith('.download') || n.startsWith('.incoming'),
      ).length,
      0,
    );
    await assert.rejects(fs.access(path.join(entry, 'pack.json')));
  } finally {
    await f.close();
  }
});
test('archive links, traversal and oversized extraction are rejected before installation', async () => {
  const f = await fixture();
  try {
    await assert.rejects(inspectArchive(f.archive, 1), /budget/);
    await fs.symlink(path.join(f.root, 'outside'), path.join(f.source, 'public/link'));
    const bad = path.join(f.root, 'link.tar.gz');
    await tar.c({ cwd: f.source, file: bad }, ['public/link', 'pack.json']);
    await assert.rejects(inspectArchive(bad), /links/);
    for (const name of ['../escape', '/absolute', 'C:/drive', 'public/../escape', 'public\\escape'])
      assert.throws(() => safeRelative(name));
  } finally {
    await f.close();
  }
});
test('cache reservations evict unused data, protect active work and enforce the total budget', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-budget-')),
    cache = new AssetCache(root, 8192);
  try {
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
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('failed lease metadata writes preserve live reservations and do not wedge subsequent cache operations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-lease-write-')),
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
  try {
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
  } finally {
    fs.writeFile = write;
    await held.release();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('failed initial cache ownership publication leaves the directory recoverable and still rejects unrelated files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-owner-write-')),
    cache = new AssetCache(root, 8192),
    write = fs.writeFile;
  try {
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
    await fs.writeFile(
      path.join(root, '.cache-owner-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.tmp'),
      '{',
    );
    await fs.writeFile(path.join(root, 'unrelated.txt'), 'preserve this');
    await assert.rejects(cache.lease('next'), /unrelated/);
    assert.equal(await fs.readFile(path.join(root, 'unrelated.txt'), 'utf8'), 'preserve this');
    await fs.rm(path.join(root, 'unrelated.txt'));
    const held = await cache.lease('next');
    await held.release();
  } finally {
    fs.writeFile = write;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('equivalence excludes only preparation provenance and binds the accepted recipe to unchanged archive bytes', async () => {
  const { payloadDigest, preparationPin, LockSchema, acceptedRecipe } =
    await import('../../tools/assets/pack');
  const { recipeInputs } = await import('../../tools/assets/recipe');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-equivalence-'));
  try {
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
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('loading media rejects missing, truncated and changed selected source bytes', async () => {
  const { validateLoadingVideo } = await import('../../tools/assets/loading-media');
  assert.throws(() => validateLoadingVideo(new Uint8Array()), /differs/);
  assert.throws(() => validateLoadingVideo(new Uint8Array(625991)), /differs/);
  assert.throws(() => validateLoadingVideo(new Uint8Array(625992)), /differs/);
});
