import { temporaryDirectory } from '../fixtures/temporary-directory';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AssetCache } from '../../tools/assets/cache';
import { openFileWorkspace } from '../../tools/assets/file-delivery';
import { downloadFile } from '../../tools/assets/download';
import { buildFileCatalog } from '../../tools/assets/file-publication';
import { preparationPin, PackSchema, type AssetLock } from '../../tools/assets/pack';
import { inventoryCandidate } from '../../tools/assets/archive';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t: TestContext) {
  const root = await temporaryDirectory(t, 'lantern-files-');
  const page = randomBytes(8192);
  const entries = {
    'public/generated/tree/manifest.json': Buffer.from('{"tree":true}'),
    'public/generated/tree/page.png': page,
    'public/generated/tree/alias.png': page,
    'public/generated/other/page.png': randomBytes(16384),
  };
  const cache = new AssetCache(path.join(root, 'cache'), 4 * 1024 ** 2);
  const held = await cache.lease('builder');
  const sourceRoot = path.join(root, 'source');
  for (const [name, bytes] of Object.entries(entries)) {
    await fs.mkdir(path.dirname(path.join(sourceRoot, name)), { recursive: true });
    await fs.writeFile(path.join(sourceRoot, name), bytes);
  }
  const candidate = await inventoryCandidate(sourceRoot, 'a'.repeat(64));
  const inventory = PackSchema.parse(
    JSON.parse(await fs.readFile(path.join(sourceRoot, 'pack.json'), 'utf8')),
  );
  const pin = {
    ...preparationPin(candidate, {}, inventory),
    schemaVersion: 3 as const,
    bundles: {},
  } as Extract<AssetLock, { schemaVersion: 3 }>;
  const objects = new Map<string, Buffer>();
  const catalog = await buildFileCatalog(pin, inventory, sourceRoot, held, async (info, file) => {
    objects.set(info.sha256 + '.bin', await fs.readFile(file));
  });
  await held.release();
  const body = gzipSync(Buffer.from(JSON.stringify(catalog)));
  pin.fileDelivery = {
    releaseTag: 'assets-catalog-' + sha(body).slice(0, 16),
    filename: 'files.json.gz',
    sha256: sha(body),
    bytes: body.length,
  };
  const calls: { file: string; bytes: number; range?: string }[] = [];
  const request: typeof fetch = async (url, init) => {
    const file = new URL(url instanceof Request ? url.url : url).pathname.split('/').at(-1)!;
    const bytes = file === 'files.json.gz' ? body : objects.get(file);
    assert.ok(bytes, 'only catalog and individually requested hashes may be downloaded');
    const range = new Headers(init?.headers).get('Range');
    if (range) {
      const [start, end] = range.slice(6).split('-').map(Number) as [number, number];
      const selected = bytes.subarray(start, end + 1);
      calls.push({ file, bytes: selected.length, range });
      return new Response(Uint8Array.from(selected), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${bytes.length}`,
          'content-length': String(selected.length),
        },
      });
    }
    calls.push({ file, bytes: bytes.length });
    return new Response(Uint8Array.from(bytes), {
      headers: { 'content-length': String(bytes.length) },
    });
  };
  return {
    root,
    pin,
    inventory,
    catalog,
    calls,
    request,
    entries,
    cache,
  };
}

test('uncached artwork downloads exactly the catalog and selected file, coalesces aliases and reuses offline', async (t) => {
  const f = await fixture(t);

  const workspace = await openFileWorkspace(f.pin, f.cache, f.request);
  assert.equal(f.calls.length, 0);
  await workspace.ensurePublicFile('generated/tree/manifest.json');
  const before = f.calls.length;
  await Promise.all([
    workspace.ensurePublicFile('generated/tree/page.png'),
    workspace.ensurePublicFile('generated/tree/page.png'),
    workspace.ensurePublicFile('generated/tree/alias.png'),
  ]);
  assert.deepEqual(f.calls.slice(before), [
    {
      file: f.catalog.files['public/generated/tree/page.png']!.container + '.bin',
      bytes: 8192,
      range: `bytes=${f.catalog.files['public/generated/tree/page.png']!.offset}-${f.catalog.files['public/generated/tree/page.png']!.offset + 8191}`,
    },
  ]);
  assert.equal(await workspace.ensurePublicFile('generated/missing.png'), false);
  await assert.rejects(fs.access(path.join(workspace.publicDirectory, 'generated/other/page.png')));
  assert.deepEqual(
    await fs.readFile(path.join(workspace.publicDirectory, 'generated/tree/page.png')),
    f.entries['public/generated/tree/page.png'],
  );
  assert.throws(() => workspace.ensurePublicFile('../escape'), /Unsafe/);
  await workspace.release();
  const offline = await openFileWorkspace(f.pin, f.cache, async () => {
    throw new Error('offline');
  });
  assert.equal(await offline.ensurePublicFile('generated/tree/page.png'), true);
  await offline.release();
  await assert.rejects(offline.ensurePublicFile('generated/tree/page.png'), /abort/i);
});

test('direct downloads reject corrupted, oversized and truncated responses without installing bytes', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-file-corrupt-');
  const target = path.join(root, 'page.png');
  const good = Buffer.from('artwork');

  for (const bad of ['corrupt', 'artwork extra', 'short']) {
    await assert.rejects(
      downloadFile(
        'https://example.test/file',
        { bytes: good.length, sha256: sha(good) },
        target,
        async () => new Response(bad),
      ),
      /differs|exceeds/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  }
});

test('catalog authenticates the complete accepted payload, not just its download hash', async (t) => {
  const f = await fixture(t);

  f.pin.preparation.payloadSha256 = 'd'.repeat(64);
  const workspace = await openFileWorkspace(f.pin, f.cache, f.request);
  await assert.rejects(workspace.ensurePublicFile('generated/tree/page.png'), /payload differs/);
  await workspace.release();
  assert.deepEqual(
    f.calls.map((c) => c.file),
    ['files.json.gz'],
  );
});

test('cancelled direct download leaves no partial file and can retry', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-file-abort-');
  const signal = new AbortController();
  const good = randomBytes(32),
    target = path.join(root, 'image');

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(good);
      signal.abort();
      controller.close();
    },
  });
  await assert.rejects(
    downloadFile(
      'https://example.test/file',
      { bytes: good.length, sha256: sha(good) },
      target,
      async () => new Response(body),
      signal.signal,
    ),
    /abort/i,
  );
  assert.deepEqual(await fs.readdir(root), []);
  await downloadFile(
    'https://example.test/file',
    { bytes: good.length, sha256: sha(good) },
    target,
    async () => new Response(Uint8Array.from(good)),
  );
  assert.deepEqual(await fs.readFile(target), good);
});

test('range delivery rejects ignored ranges, wrong offsets and encoded bodies before installation', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-file-range-');
  const target = path.join(root, 'page');
  const bytes = Buffer.from('image');
  const info = { bytes: bytes.length, sha256: sha(bytes) };

  for (const response of [
    new Response('entire container', { status: 200 }),
    new Response('image', { status: 206, headers: { 'content-range': 'bytes 0-4/100' } }),
    new Response('image', {
      status: 206,
      headers: { 'content-range': 'bytes 10-14/100', 'content-encoding': 'gzip' },
    }),
  ]) {
    await assert.rejects(
      downloadFile(
        'https://example.test/container',
        info,
        target,
        async () => response,
        undefined,
        { offset: 10, totalBytes: 100 },
      ),
      /exact byte range/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  }
  await downloadFile(
    'https://example.test/container',
    info,
    target,
    async (_, init) => {
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=10-14');
      return new Response('image', {
        status: 206,
        headers: { 'content-range': 'bytes 10-14/100', 'content-length': '5' },
      });
    },
    undefined,
    { offset: 10, totalBytes: 100 },
  );
  assert.deepEqual(await fs.readFile(target), bytes);
});

test('container publication rejects source drift and deduplicates identical files', async (t) => {
  const f = await fixture(t);

  const page = f.catalog.files['public/generated/tree/page.png']!;
  const alias = f.catalog.files['public/generated/tree/alias.png']!;
  assert.equal(page.container, alias.container);
  assert.equal(page.offset, alias.offset);
  await fs.writeFile(path.join(f.root, 'source/public/generated/tree/page.png'), 'changed');
  await fs.writeFile(path.join(f.root, 'source/public/generated/tree/alias.png'), 'changed');
  const held = await f.cache.lease('drift');
  try {
    await assert.rejects(
      buildFileCatalog(f.pin, f.inventory, path.join(f.root, 'source'), held, async () => {}),
      /Source file changed/,
    );
  } finally {
    await held.release();
  }
});

test('disposing a development workspace aborts in-flight acquisition and releases its lease', async (t) => {
  const f = await fixture(t);

  const { promise: fetching, resolve: started } = Promise.withResolvers<void>();
  const request = (async (_url, init) => {
    started();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  }) as typeof fetch;

  const workspace = await openFileWorkspace(f.pin, f.cache, request);
  const pending = workspace.ensurePublicFile('generated/tree/page.png');
  const rejected = assert.rejects(pending, /abort/i);
  await fetching;
  await workspace.release();
  await rejected;
  assert.deepEqual(await fs.readdir(path.join(workspace.root, '.leases')), []);
});

test('temporary cache reservation failure does not poison a later artwork retry', async (t) => {
  const f = await fixture(t);
  const lease = f.cache.lease.bind(f.cache);
  let denied = true;
  f.cache.lease = async (...args) => {
    const held = await lease(...args);
    return {
      ...held,
      reserve: async (bytes: number) => {
        if (denied) {
          denied = false;
          throw new Error('Temporary cache contention');
        }
        await held.reserve(bytes);
      },
    };
  };

  const workspace = await openFileWorkspace(f.pin, f.cache, f.request);
  try {
    await assert.rejects(
      workspace.ensurePublicFile('generated/tree/manifest.json'),
      /Temporary cache contention/,
    );
    assert.equal(await workspace.ensurePublicFile('generated/tree/manifest.json'), true);
  } finally {
    await workspace.release();
  }
});
