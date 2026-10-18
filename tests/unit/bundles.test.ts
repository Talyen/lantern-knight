import { readJson } from '../../tools/json-file';
import { openDemandWorkspace } from '../../tools/assets/demand';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeArchive, inventoryCandidate } from '../../tools/assets/archive';
import { ensureBundlePack } from '../../tools/assets/bundles';
import { AssetCache } from '../../tools/assets/cache';
import { preparationPin, PackSchema } from '../../tools/assets/pack';
test('runtime consumers fetch only runtime bundles; authoring reuses them and verifies its additional bytes', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-bundle-');

  const locks: Record<string, Awaited<ReturnType<typeof makeArchive>>> = {},
    archives = new Map<string, Buffer>(),
    combined = path.join(root, 'combined');
  for (const name of ['runtime', 'authoring']) {
    const source = path.join(root, name);
    for (const directory of [source, combined]) {
      await fs.mkdir(path.join(directory, 'public'), { recursive: true });
      await fs.writeFile(path.join(directory, 'public', name + '.txt'), name);
    }
    const archive = path.join(root, name + '.tar.gz');
    const lock = await makeArchive(source, archive, 'a'.repeat(64));
    locks[name] = lock;
    archives.set(lock.releaseTag, await fs.readFile(archive));
  }
  const candidate = await inventoryCandidate(combined, 'a'.repeat(64));
  const inventory = PackSchema.parse(await readJson(path.join(combined, 'pack.json')));
  const accepted = preparationPin(candidate, {}, inventory);
  if (accepted.schemaVersion !== 2) throw new Error('Expected accepted preparation');
  const pin = { ...accepted, schemaVersion: 3 as const, bundles: locks };
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
  const authoring = await openDemandWorkspace(pin, cache, fetcher);
  assert.equal(
    authoring.ensurePublicFile,
    undefined,
    'Older pins acquire complete authoring bundles',
  );
  try {
    assert.equal(
      await fs.readFile(path.join(authoring.root, 'public/authoring.txt'), 'utf8'),
      'authoring',
    );
    assert.deepEqual(requests, [locks.runtime!.releaseTag, locks.authoring!.releaseTag]);
  } finally {
    await authoring.release();
  }
  await cache.clean(new Set(['pack-' + pin.sha256 + '-authoring']));
  const offline = (async () => {
    throw new Error('Cached authoring must work without reacquiring evicted bundles');
  }) as typeof fetch;
  const reused = await ensureBundlePack(pin, cache, offline, 'authoring');
  await reused.release();
  await fs.writeFile(path.join(reused.root, 'public/authoring.txt'), 'tampered');
  await assert.rejects(ensureBundlePack(pin, cache, offline, 'authoring'));
});
