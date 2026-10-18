import { onAsyncExit } from '../../tools/scope-exit';
import { readJson } from '../../tools/json-file';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import timers from 'node:timers/promises';
import { AssetCache } from '../../tools/assets/cache';
import { openFileWorkspace, parseFileCatalog } from '../../tools/assets/file-delivery';
import { downloadFile } from '../../tools/assets/download';
import { buildFileCatalog, publishIndividualFiles } from '../../tools/assets/file-publication';
import {
  filePin,
  preparationPin,
  payloadDigest,
  PackSchema,
  LockSchema,
  type AssetLock,
} from '../../tools/assets/pack';
import { acquirePinnedPack } from '../../tools/assets/pinned';
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
  const inventory = PackSchema.parse(await readJson(path.join(sourceRoot, 'pack.json')));
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

test('verified cached files need no growth admission, while new and corrupt files still do', async (t) => {
  const f = await fixture(t);
  const initial = await openFileWorkspace(f.pin, f.cache, f.request);
  await initial.ensurePublicFile('generated/tree/page.png');
  await initial.release();
  const lease = f.cache.lease.bind(f.cache);
  t.mock.method(f.cache, 'lease', async (...args: Parameters<typeof lease>) => {
    const held = await lease(...args);
    return {
      ...held,
      reserve: async () => {
        throw new Error('No growth available');
      },
    };
  });
  const workspace = await openFileWorkspace(f.pin, f.cache, f.request);
  await using _cleanup = onAsyncExit(() => workspace.release());
  const downloads = f.calls.length;
  assert.equal(await workspace.ensurePublicFile('generated/tree/page.png'), true);
  assert.equal(f.calls.length, downloads, 'the verified catalog and page are reused offline');
  await assert.rejects(workspace.ensurePublicFile('generated/other/page.png'), /No growth/);
  await fs.writeFile(
    path.join(workspace.publicDirectory, 'generated/tree/page.png'),
    Buffer.alloc(8192),
  );
  await assert.rejects(workspace.ensurePublicFile('generated/tree/page.png'), /No growth/);
  assert.equal(f.calls.length, downloads, 'new bytes cannot bypass reservation');
});

test('downloads release rejected response bodies, including local setup failures', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-file-response-');
  const target = path.join(root, 'page');
  const info = { bytes: 5, sha256: sha(Buffer.from('image')) };
  for (const status of [404, 200]) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true;
        },
      }),
      {
        status,
      },
    );
    // A regular file in place of the parent makes setup fail before body consumption.
    const destination = status === 200 ? path.join(target, 'child') : target;
    if (status === 200) await fs.writeFile(target, 'preserve');
    await assert.rejects(
      downloadFile('https://example.test/file', info, destination, async () => response),
    );
    assert.equal(cancelled, true, 'unused network body must be cancelled');
  }
  assert.equal(await fs.readFile(target, 'utf8'), 'preserve');
});

// Advance the actual promise timer when backoff is installed, after I/O cleanup.
function retryClock(t: TestContext, onWait = () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wait = timers.setTimeout;
  t.mock.method(timers, 'setTimeout', (...args: Parameters<typeof wait>) => {
    const ms = args[0] ?? 1;
    assert.ok(ms > 0, 'transport retries must yield through a backoff');
    const pending = wait(...args);
    onWait();
    t.mock.timers.tick(ms);
    return pending;
  });
}

test('range downloads retry interrupted transport without retaining partial bytes', async (t) => {
  retryClock(t);
  const root = await temporaryDirectory(t, 'lantern-file-retry-');
  const target = path.join(root, 'page'),
    bytes = Buffer.from('image'),
    failure = new TypeError('fetch failed', {
      cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    });
  let attempts = 0;
  await downloadFile(
    'https://example.test/container',
    { bytes: bytes.length, sha256: sha(bytes) },
    target,
    async (_, init) => {
      attempts++;
      assert.deepEqual(await fs.readdir(root), [], 'previous attempt must be fully unwound');
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=10-14');
      if (attempts === 1) throw failure;
      let chunks = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (attempts === 2 && chunks++) controller.error(failure);
          else if (attempts === 2) controller.enqueue(Uint8Array.from(bytes.subarray(0, 2)));
          else {
            controller.enqueue(Uint8Array.from(bytes));
            controller.close();
          }
        },
      });
      return new Response(body, { status: 206, headers: { 'content-range': 'bytes 10-14/100' } });
    },
    undefined,
    { offset: 10, totalBytes: 100 },
  );
  assert.equal(attempts, 3);
  assert.deepEqual(await fs.readFile(target), bytes);
  assert.deepEqual(await fs.readdir(root), ['page']);
});

test('transport retries stop after three attempts and cancellation ends their backoff', async (t) => {
  let cancelBackoff: (() => void) | undefined;
  retryClock(t, () => cancelBackoff?.());
  const root = await temporaryDirectory(t, 'lantern-file-retry-limit-'),
    target = path.join(root, 'page'),
    info = { bytes: 5, sha256: sha(Buffer.from('image')) },
    failure = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
  let attempts = 0;
  await assert.rejects(
    downloadFile('https://example.test/file', info, target, async () => {
      attempts++;
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(attempts, 3);
  assert.deepEqual(await fs.readdir(root), []);
  const cancellation = new AbortController();
  cancelBackoff = () => cancellation.abort();
  attempts = 0;
  await assert.rejects(
    downloadFile(
      'https://example.test/file',
      info,
      target,
      async () => {
        attempts++;
        throw failure;
      },
      cancellation.signal,
    ),
    /abort/i,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(await fs.readdir(root), []);
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
  await using _cleanup1 = onAsyncExit(() => held.release());
  await assert.rejects(
    buildFileCatalog(f.pin, f.inventory, path.join(f.root, 'source'), held, async () => {}),
    /Source file changed/,
  );
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
  await using _cleanup2 = onAsyncExit(() => workspace.release());
  await assert.rejects(
    workspace.ensurePublicFile('generated/tree/manifest.json'),
    /Temporary cache contention/,
  );
  assert.equal(await workspace.ensurePublicFile('generated/tree/manifest.json'), true);
});

test('delta publication retains immutable locations across renames, aliases and deletions; only new hashes are packed', async (t) => {
  const f = await fixture(t);
  const source = path.join(f.root, 'source');
  const old = f.catalog.files['public/generated/tree/page.png']!;
  await fs.rename(
    path.join(source, 'public/generated/tree/page.png'),
    path.join(source, 'public/renamed.png'),
  );
  await fs.rm(path.join(source, 'public/generated/other/page.png'));
  const added = Buffer.from('new artwork');
  await fs.writeFile(path.join(source, 'public/new.png'), added);
  await fs.writeFile(path.join(source, 'public/empty'), '');
  const candidate = await inventoryCandidate(source, f.pin.recipeSha256);
  const inventory = PackSchema.parse(await readJson(path.join(source, 'pack.json')));
  const pin = { ...f.pin, ...preparationPin(candidate, {}, inventory), schemaVersion: 3 as const };
  // An unchanged object's bytes need not be staged or read to retain its location.
  await fs.rm(path.join(source, 'public/renamed.png'));
  await fs.rm(path.join(source, 'public/generated/tree/alias.png'));
  await fs.rm(path.join(source, 'public/generated/tree/manifest.json'));
  const held = await f.cache.lease('delta');
  await using _cleanup = onAsyncExit(() => held.release());
  const packed: Buffer[] = [];
  const next = await buildFileCatalog(
    pin,
    inventory,
    source,
    held,
    async (_info, file) => {
      packed.push(await fs.readFile(file));
    },
    f.catalog,
  );
  assert.equal(next.files['public/renamed.png']!.container, old.container);
  assert.equal(next.files['public/renamed.png']!.offset, old.offset);
  assert.deepEqual(next.files['public/renamed.png'], next.files['public/generated/tree/alias.png']);
  assert.equal(next.files['public/generated/other/page.png'], undefined);
  assert.deepEqual(
    new Set(Object.keys(next.containers)),
    new Set(Object.values(next.files).map((file) => file.container)),
  );
  assert.equal(
    packed.reduce((n, bytes) => n + bytes.length, 0),
    added.length + 1,
    'new content plus the empty-container sentinel only',
  );
  assert.deepEqual(parseFileCatalog(next, pin.preparation.payloadSha256), next);
  const unchanged = await buildFileCatalog(
    pin,
    inventory,
    source,
    held,
    async () => {
      assert.fail('unchanged content must not be rewritten or uploaded');
    },
    next,
  );
  assert.deepEqual(unchanged, next);
  const invalid = structuredClone(next);
  invalid.files['public/renamed.png']!.offset = Number.MAX_SAFE_INTEGER;
  assert.throws(() => parseFileCatalog(invalid, pin.preparation.payloadSha256), /byte range/);
  invalid.payloadSha256 = 'f'.repeat(64);
  await assert.rejects(
    buildFileCatalog(pin, inventory, source, held, async () => {}, invalid),
    /payload/,
  );
});

test('an already published file pin verifies remote ranges without acquiring or republishing the complete payload', async (t) => {
  const f = await fixture(t);
  f.pin.bundles = {
    runtime: {
      schemaVersion: 1,
      releaseTag: 'assets-' + 'a'.repeat(16),
      filename: 'lantern-assets.tar.gz',
      sha256: 'a'.repeat(64),
      bytes: 1,
      recipeSha256: 'a'.repeat(64),
      inventorySha256: 'b'.repeat(64),
    },
  };
  const accepted = LockSchema.parse(f.pin);
  if (accepted.schemaVersion !== 3) throw new Error('Expected bundled pin');
  f.pin = accepted;
  const target = path.join(f.root, 'lock.json');
  await fs.writeFile(target, JSON.stringify(f.pin));
  const before = await fs.readFile(target, 'utf8');
  await publishIndividualFiles(
    f.pin,
    f.cache,
    async (args) => {
      assert.equal(args[0], 'api', 'unchanged delivery must not upload');
      const assets = Object.entries(f.catalog.containers).map(([hash, info]) => ({
        name: hash + '.bin',
        size: info.bytes,
        digest: 'sha256:' + hash,
      }));
      return JSON.stringify(args.includes('--paginate') ? [assets] : { id: 'fixture', assets });
    },
    target,
    f.request,
  );
  const upgraded = LockSchema.parse(JSON.parse(await fs.readFile(target, 'utf8')));
  assert.equal(upgraded.schemaVersion, 4);
  assert.deepEqual(upgraded.preparation, JSON.parse(before).preparation);
  assert.deepEqual(upgraded.fileDelivery, JSON.parse(before).fileDelivery);
  assert.equal(upgraded.sha256, f.pin.sha256);
  assert.ok(!('bundles' in upgraded));
  assert.equal(
    f.calls.filter((call) => !call.range).length,
    1,
    'only the authenticated catalog is downloaded whole',
  );
  assert.equal(
    f.calls.filter((call) => call.range).length,
    Object.keys(f.catalog.containers).length,
  );
  assert.equal(
    (await fs.readdir(path.join(f.cache.root, 'entries'))).some((name) => name.startsWith('pack-')),
    false,
  );
  const changed = { ...f.catalog, payloadSha256: 'f'.repeat(64) };
  assert.throws(() => parseFileCatalog(changed, f.pin.preparation.payloadSha256), /payload/);
  assert.equal(payloadDigest(f.inventory), f.pin.preparation.payloadSha256);
});

test('container construction falls back to one worker when the cache grants only one transfer', async (t) => {
  const f = await fixture(t);
  const held = await f.cache.lease('serial-publication');
  await using _cleanup = onAsyncExit(() => held.release());
  let active = 0;
  let peak = 0;
  const catalog = await buildFileCatalog(
    f.pin,
    f.inventory,
    path.join(f.root, 'source'),
    {
      ...held,
      reserveUpTo: (required) => held.reserveUpTo(required, required),
    },
    async () => {
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
    },
  );
  assert.equal(peak, 1);
  assert.deepEqual(catalog, f.catalog, 'serial fallback delivers the same deterministic catalog');
});

test('version 4 full acquisition downloads each container once and then works offline', async (t) => {
  const f = await fixture(t);
  const pin = filePin(f.pin, f.pin.fileDelivery!);
  const workspace = await acquirePinnedPack(pin, f.cache, 'authoring', f.request);
  for (const [name, bytes] of Object.entries(f.entries))
    assert.deepEqual(await fs.readFile(path.join(workspace.root, name)), bytes);
  assert.equal(f.calls.filter((call) => call.range).length, 0);
  assert.equal(f.calls.length, Object.keys(f.catalog.containers).length + 1);
  await workspace.release();
  const offline = await acquirePinnedPack(pin, f.cache, 'authoring', async () => {
    throw new Error('complete acquisition must be reusable offline');
  });
  await offline.release();
});

test('complete acquisition rejects a corrupt container before installing its files', async (t) => {
  const f = await fixture(t);
  const workspace = await openFileWorkspace(
    filePin(f.pin, f.pin.fileDelivery!),
    f.cache,
    async (url, init) => {
      const response = await f.request(url, init);
      if (String(url).endsWith('files.json.gz')) return response;
      const bytes = Buffer.from(await response.arrayBuffer());
      bytes[0] = bytes[0]! ^ 255;
      return new Response(bytes);
    },
  );
  await assert.rejects(workspace.materializeAll(), /hash or size differs/);
  await workspace.release();
  await assert.rejects(fs.access(workspace.publicDirectory), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.join(workspace.root, '.leases')), []);
  assert.ok(!(await fs.readdir(workspace.root)).some((name) => name.startsWith('.container-')));
});

test('complete acquisition coalesces calls and disposal drains its cancelled transport', async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers<void>();
  const workspace = await openFileWorkspace(
    filePin(f.pin, f.pin.fileDelivery!),
    f.cache,
    async (url, init) => {
      if (String(url).endsWith('files.json.gz')) return f.request(url, init);
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    },
  );
  const pending = workspace.materializeAll();
  assert.equal(workspace.materializeAll(), pending);
  const rejected = assert.rejects(pending, /abort/i);
  await started.promise;
  await workspace.release();
  await rejected;
  assert.deepEqual(await fs.readdir(path.join(workspace.root, '.leases')), []);
});
