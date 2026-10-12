import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { AssetCache } from '../../tools/assets/cache';
import { makeArchive, inventoryCandidate } from '../../tools/assets/archive';
import { preparationPin, type AssetLock } from '../../tools/assets/pack';
import { openDemandWorkspace } from '../../tools/assets/demand';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-demand-'));
  const cache = new AssetCache(path.join(root, 'cache'), 2 * 1024 ** 2);
  const bundles: Record<string, Extract<AssetLock, { schemaVersion: 1 }>> = {};
  const bodies = new Map<string, Buffer>();
  const files = {
    runtime: {
      'public/registration.json': Buffer.from('{}'),
      'public/hero.png': randomBytes(32768),
    },
    authoring: {
      'public/generated/library/catalog.json': Buffer.from(
        '{"library-tree":"generated/tree/manifest.json"}',
      ),
      'public/generated/tree/manifest.json': Buffer.from('{"tree":true}'),
      'public/generated/tree/page.png': randomBytes(131072),
    },
  };
  const combined = path.join(root, 'combined');
  for (const [name, entries] of Object.entries(files)) {
    const source = path.join(root, name);
    for (const [file, bytes] of Object.entries(entries)) {
      for (const directory of [source, combined]) {
        await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
        await fs.writeFile(path.join(directory, file), bytes);
      }
    }
    const archive = path.join(root, name + '.tar.gz');
    const lock = await makeArchive(source, archive, 'a'.repeat(64));
    bundles[name] = lock;
    bodies.set(lock.releaseTag, await fs.readFile(archive));
  }
  const candidate = await inventoryCandidate(combined, 'a'.repeat(64));
  const inv = JSON.parse(await fs.readFile(path.join(combined, 'pack.json'), 'utf8'));
  const accepted = preparationPin(candidate, {}, inv);
  if (accepted.schemaVersion === 1) throw new Error('Expected accepted preparation');
  const pin = { ...accepted, schemaVersion: 3 as const, bundles };
  const calls: { tag: string; range: boolean }[] = [];
  const request = (async (url, init) => {
    const tag = new URL(url instanceof Request ? url.url : url).pathname.split('/').at(-2)!;
    const body = bodies.get(tag)!;
    const range = new Headers(init?.headers).get('Range');
    calls.push({ tag, range: !!range });
    const end = range ? Number(range.split('-')[1]) + 1 : body.length;
    return new Response(Uint8Array.from(body.subarray(0, end)), { status: range ? 206 : 200 });
  }) as typeof fetch;
  return {
    root,
    cache,
    pin,
    calls,
    request,
    files,
    bodies,
    close: () => fs.rm(root, { recursive: true, force: true }),
  };
}

test('development artwork is demand loaded, deduplicated, verified and reusable offline', async () => {
  const f = await fixture();
  try {
    const workspace = await openDemandWorkspace(f.pin, f.cache, f.request);
    assert.equal(f.calls.length, 0, 'starting the server acquires no artwork');
    assert.equal(await workspace.ensurePublicFile('generated/library/catalog.json'), true);
    assert.equal(f.calls.filter((c) => !c.range).length, 1, 'only requested metadata is streamed');
    await assert.rejects(fs.access(path.join(workspace.root, 'public/generated/tree/page.png')));
    assert.deepEqual(
      await Promise.all(
        Array.from({ length: 6 }, () => workspace.ensurePublicFile('generated/tree/page.png')),
      ),
      Array(6).fill(true),
    );
    assert.equal(
      f.calls.filter((c) => !c.range).length,
      2,
      'concurrent page requests share one download',
    );
    const page = path.join(workspace.publicDirectory, 'generated/tree/page.png');
    assert.deepEqual(await fs.readFile(page), f.files.authoring['public/generated/tree/page.png']);
    assert.equal(await workspace.ensurePublicFile('generated/missing.png'), false);
    assert.throws(() => workspace.ensurePublicFile('../outside'), /Unsafe asset path/);
    await workspace.release();
    const offline = await openDemandWorkspace(f.pin, f.cache, (async () => {
      throw new Error('offline');
    }) as typeof fetch);
    assert.equal(await offline.ensurePublicFile('generated/library/catalog.json'), true);
    assert.equal(await offline.ensurePublicFile('generated/tree/page.png'), true);
    await offline.release();
    await assert.rejects(offline.ensurePublicFile('generated/tree/page.png'), /abort/i);
  } finally {
    await f.close();
  }
});

test('a signed inventory cannot authorize corrupt metadata and failed requests can retry', async () => {
  const f = await fixture();
  let corrupt = true;
  try {
    const request = (async (url, init) => {
      if (!new Headers(init?.headers).has('Range') && corrupt)
        return new Response('not an archive');
      return f.request(url, init);
    }) as typeof fetch;
    const workspace = await openDemandWorkspace(f.pin, f.cache, request);
    await assert.rejects(workspace.ensurePublicFile('generated/tree/manifest.json'));
    await assert.rejects(
      fs.access(path.join(workspace.publicDirectory, 'generated/tree/manifest.json')),
    );
    corrupt = false;
    assert.equal(await workspace.ensurePublicFile('generated/tree/manifest.json'), true);
    const bytes = await fs.readFile(
      path.join(workspace.publicDirectory, 'generated/tree/manifest.json'),
    );
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      createHash('sha256')
        .update(f.files.authoring['public/generated/tree/manifest.json'])
        .digest('hex'),
    );
    await workspace.release();
  } finally {
    await f.close();
  }
});

test('matching development server reuse acquires no asset workspace', async () => {
  const { createServer } = await import('node:http');
  const { projectRoot } = await import('../../tools/assets/paths');
  const { readLock } = await import('../../tools/assets/pack');
  const { openPreview } = await import('../../tools/preview-session');
  const identity = {
    root: await fs.realpath(projectRoot),
    assets: (await readLock()).sha256,
    target: 'development',
    scope: 'authoring',
  };
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(identity));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server');
    const options = {
      output: 'development' as const,
      assets: 'pinned' as const,
      scope: 'authoring' as const,
      port: address.port,
      reuse: true,
      demand: true,
    };
    const session = await openPreview(options);
    assert.equal(session.ownsServer, false);
    assert.equal(session.workspace, undefined);
    assert.equal(session.assetIdentity, identity.assets);
    await session.close();
    identity.assets = '0'.repeat(64);
    await assert.rejects(openPreview(options), /another checkout or asset identity/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('disposing a development workspace aborts in-flight acquisition and releases its lease', async () => {
  const f = await fixture();
  let started!: () => void;
  const fetching = new Promise<void>((resolve) => {
    started = resolve;
  });
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
  try {
    const workspace = await openDemandWorkspace(f.pin, f.cache, request);
    const pending = workspace.ensurePublicFile('generated/tree/page.png');
    const rejected = assert.rejects(pending, /abort/i);
    await fetching;
    await workspace.release();
    await rejected;
    assert.deepEqual(await fs.readdir(path.join(workspace.root, '.leases')), []);
  } finally {
    await f.close();
  }
});

test('ground selection acquires its original source image before invoking segmentation', async () => {
  const { SegmentationService } = await import('../../tools/segmentation/service');
  const { manifestFixture } = await import('../fixtures/manifest');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-demand-selection-'));
  const publicRoot = path.join(root, 'public');
  const manifest = manifestFixture('library-tree');
  const file = 'generated/library/library-tree/manifest.json';
  const source = path.posix.join(path.posix.dirname(file), manifest.pages[0]!.path);
  const calls: string[] = [];
  const service = new SegmentationService(root, publicRoot, async (relative) => {
    calls.push(relative);
    if (relative === source) throw new Error('Source requested before model execution');
    await fs.mkdir(path.dirname(path.join(publicRoot, relative)), { recursive: true });
    await fs.writeFile(
      path.join(publicRoot, relative),
      JSON.stringify(relative === file ? manifest : { 'library-tree': file }),
    );
    return true;
  });
  try {
    await assert.rejects(
      service.select(
        {
          asset: 'library-tree',
          frame: manifest.frames[0]!.id,
          hash: manifest.pages[0]!.hash,
          crop: [0, 0, 1, 1],
          box: [0, 0, 1, 1],
        },
        new AbortController().signal,
      ),
      /Source requested before model execution/,
    );
    assert.deepEqual(calls, ['generated/library/catalog.json', file, source]);
  } finally {
    service.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('temporary cache reservation failure does not poison a later artwork retry', async () => {
  const f = await fixture();
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
  try {
    const workspace = await openDemandWorkspace(f.pin, f.cache, f.request);
    try {
      await assert.rejects(
        workspace.ensurePublicFile('generated/tree/manifest.json'),
        /Temporary cache contention/,
      );
      assert.equal(await workspace.ensurePublicFile('generated/tree/manifest.json'), true);
    } finally {
      await workspace.release();
    }
  } finally {
    await f.close();
  }
});
