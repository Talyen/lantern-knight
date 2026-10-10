import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { manifestFixture } from '../fixtures/manifest';
import { gameAssetCatalog } from '../../src/content/asset-catalog';
import { loadingVideoPath } from '../../src/content/loading-media';
import { AssetCache } from '../../tools/assets/cache';
import { makeArchive } from '../../tools/assets/archive';
import { recipeHash, LockSchema, type AssetLock } from '../../tools/assets/pack';
import { publishBundledPrepared } from '../../tools/assets/publication';
import { ensureBundlePack } from '../../tools/assets/bundles';

test('split publication uses downloadable filenames, frees the candidate archive and preserves the pin on failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-publication-')),
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
  try {
    for (const [id, file] of Object.entries(gameAssetCatalog)) {
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
    for (const file of ['lighting/manifest.json', 'visual-effects/surfaces.json'])
      await write('public/' + file, JSON.stringify({ entries: {} }));
    await write('public/authoring-only.png', 'distinct authoring artwork');
    const lock = await makeArchive(payload, archive, await recipeHash()),
      candidate = { held, payload, archive, lock },
      uploads = new Map<string, Buffer>();
    await fs.writeFile(target, JSON.stringify(lock));
    const publish = async (args: string[]) => {
      if (args[1] === 'view') throw new Error('release not found');
      if (args[0] === 'api') return 'a'.repeat(40);
      assert.equal(args[1], 'create');
      const file = args[3]!.split('#')[0]!;
      uploads.set(args[2]! + '/' + path.basename(file), await fs.readFile(file));
      return '';
    };
    const verify = async (part: AssetLock) => {
      const bytes = uploads.get(part.releaseTag + '/' + part.filename);
      assert.ok(bytes, 'the pinned download filename must exist');
      assert.equal(bytes.length, part.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), part.sha256);
    };
    await assert.rejects(
      publishBundledPrepared(candidate, publish, verify, target, async () => {
        throw new Error('interrupted before pin');
      }),
      /interrupted before pin/,
    );
    assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), lock);
    await assert.rejects(fs.access(archive), { code: 'ENOENT' });
    await makeArchive(payload, archive, lock.recipeSha256);
    await publishBundledPrepared(candidate, publish, verify, target);
    const pin = LockSchema.parse(JSON.parse(await fs.readFile(target, 'utf8')));
    assert.equal(pin.schemaVersion, 3);
    if (pin.schemaVersion !== 3) throw new Error('Expected split pin');
    const acquired = await ensureBundlePack(pin, cache, async (url) => {
      const parsed = new URL(url instanceof Request ? url.url : url),
        key = parsed.pathname.split('/').slice(-2).join('/');
      return new Response(Uint8Array.from(uploads.get(key)!));
    });
    try {
      assert.equal(
        await fs.readFile(path.join(acquired.root, 'public/authoring-only.png'), 'utf8'),
        'distinct authoring artwork',
      );
    } finally {
      await acquired.release();
    }
  } finally {
    await held.release();
    await fs.rm(root, { recursive: true, force: true });
  }
});
