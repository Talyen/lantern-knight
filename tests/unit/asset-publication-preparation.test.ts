import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { AssetCache } from '../../tools/assets/cache';
import { preparePublicationCandidate } from '../../tools/assets/prepare';

const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
test('publication reuses the verified inventory without relinking; changed source refreshes and corruption fails closed', async (t) => {
  const root = await temporaryDirectory(t, 'publication-staging-');
  const source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'public'), { recursive: true });
  const name = 'public/art.png';
  const original = 'original artwork';
  await fs.writeFile(path.join(source, name), original);
  const files = { [name]: sha(original) };
  const cache = new AssetCache(path.join(root, 'cache'), 1024 ** 2);
  const first = await preparePublicationCandidate(source, sha('recipe'), files, cache);
  const before = await fs.stat(path.join(first.payload, name));
  const lock = first.lock;
  await first.held.release();
  const second = await preparePublicationCandidate(source, sha('recipe'), files, cache);
  const after = await fs.stat(path.join(second.payload, name));
  assert.deepEqual(second.lock, lock);
  assert.equal(after.ino, before.ino);
  assert.equal(
    after.ctimeMs,
    before.ctimeMs,
    'reuse must not change the hardlink identity or invalidate source proofs',
  );
  await second.held.release();
  // Same-size tampering with restored mtime still invalidates the receipt.
  await fs.writeFile(path.join(first.payload, name), 'modified artwork');
  await fs.utimes(path.join(first.payload, name), before.atime, before.mtime);
  await assert.rejects(
    preparePublicationCandidate(source, sha('recipe'), files, cache),
    /Prepared asset differs/,
  );
  assert.deepEqual(await fs.readdir(path.join(first.held.root, '.leases')), []);
  const changed = { [name]: sha('modified artwork') };
  const refreshed = await preparePublicationCandidate(source, sha('recipe'), changed, cache);
  assert.notEqual(refreshed.lock.inventorySha256, lock.inventorySha256);
  await refreshed.held.release();
});

test('an interrupted candidate without its inventory rebuilds from verified preparation', async (t) => {
  const root = await temporaryDirectory(t, 'publication-resume-');
  const source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'public'), { recursive: true });
  await fs.writeFile(path.join(source, 'public/art.png'), 'art');
  const cache = new AssetCache(path.join(root, 'cache'), 1024 ** 2);
  const candidate = await preparePublicationCandidate(
    source,
    sha('recipe'),
    { 'public/art.png': sha('art') },
    cache,
  );
  await fs.rm(path.join(candidate.payload, 'pack.json'));
  await candidate.held.release();
  const resumed = await preparePublicationCandidate(
    source,
    sha('recipe'),
    { 'public/art.png': sha('art') },
    cache,
  );
  assert.deepEqual(resumed.lock, candidate.lock);
  await resumed.held.release();
});
