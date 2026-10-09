import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { makeArchive } from '../../tools/assets/archive';
import { ensureBundlePack } from '../../tools/assets/bundles';
import { AssetCache } from '../../tools/assets/cache';
import { LockSchema } from '../../tools/assets/pack';
test('runtime consumers fetch only runtime bundles; authoring reuses them and verifies its additional bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-bundle-'));
  try {
    const locks: Record<string, Awaited<ReturnType<typeof makeArchive>>> = {},
      archives = new Map<string, Buffer>();
    for (const name of ['runtime', 'authoring']) {
      const source = path.join(root, name);
      await fs.mkdir(path.join(source, 'public'), { recursive: true });
      await fs.writeFile(path.join(source, 'public', name + '.txt'), name);
      const archive = path.join(root, name + '.tar.gz');
      const lock = await makeArchive(source, archive, 'a'.repeat(64));
      locks[name] = lock;
      archives.set(lock.releaseTag, await fs.readFile(archive));
    }
    const pin = LockSchema.parse({
      ...locks.runtime,
      schemaVersion: 3,
      bundles: locks,
      preparation: {
        inputs: {},
        recipeSha256: createHash('sha256').update('{}').digest('hex'),
        payloadSha256: 'a'.repeat(64),
      },
    });
    assert.equal(pin.schemaVersion, 3);
    if (pin.schemaVersion !== 3) throw new Error('Expected bundle pin');
    const cache = new AssetCache(path.join(root, 'cache'), 1024 * 1024),
      requests: string[] = [];
    const fetcher = (async (url: string | URL | Request) => {
      const tag = (url instanceof Request ? url.url : url.toString()).split('/').at(-2)!;
      requests.push(tag);
      return new Response(new Uint8Array(archives.get(tag)!));
    }) as typeof fetch;
    const runtime = await ensureBundlePack(pin, cache, fetcher, 'runtime');
    try {
      assert.equal(
        await fs.readFile(path.join(runtime.root, 'public/runtime.txt'), 'utf8'),
        'runtime',
      );
      await assert.rejects(fs.access(path.join(runtime.root, 'public/authoring.txt')));
      assert.deepEqual(requests, [locks.runtime!.releaseTag]);
    } finally {
      await runtime.release();
    }
    const authoring = await ensureBundlePack(pin, cache, fetcher, 'authoring');
    try {
      assert.equal(
        await fs.readFile(path.join(authoring.root, 'public/authoring.txt'), 'utf8'),
        'authoring',
      );
      assert.deepEqual(requests, [locks.runtime!.releaseTag, locks.authoring!.releaseTag]);
    } finally {
      await authoring.release();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
