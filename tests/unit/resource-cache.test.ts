import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceCache } from '../../src/assets/resource-cache';

test('cache accounting follows pinned leases, LRU eviction, failed loads and shutdown', async (t) => {
  const cache = new ResourceCache<number>((value) => value, 4, 2);
  t.after(() => cache.dispose());
  const first = await cache.acquire('first', async () => 3);
  const shared = await cache.acquire('first', async () => assert.fail('shared load'));
  const second = await cache.acquire('second', async () => 2);
  assert.equal(cache.bytes, 5);
  first.release();
  first.release();
  assert.equal(cache.bytes, 5, 'a shared borrower still pins the first value');
  second.release();
  assert.equal(cache.bytes, 3, 'only an unleased value can be evicted');
  const third = await cache.acquire('third', async () => 1);
  third.release();
  shared.release();
  assert.equal(cache.bytes, 4);
  const touched = await cache.acquire('first', async () => assert.fail('cached load'));
  touched.release();
  const fourth = await cache.acquire('fourth', async () => 1);
  assert.equal(cache.bytes, 4, 'a cache hit keeps the first value newer than the third');
  await assert.rejects(
    cache.acquire('failed', async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
  assert.equal(cache.bytes, 4);
  const recovered = await cache.acquire('failed', async () => 1);
  assert.equal(cache.bytes, 2);
  cache.dispose();
  fourth.release();
  recovered.release();
  assert.equal(cache.bytes, 0);
  await assert.rejects(
    cache.acquire('closed', async () => 1),
    /abort/i,
  );
});

test('cache shutdown during weight calculation cannot restore discarded memory', async () => {
  const cache = new ResourceCache<number>(() => {
    cache.dispose();
    return 3;
  }, 4);
  await assert.rejects(
    cache.acquire('first', async () => 3),
    /abort/i,
  );
  assert.equal(cache.bytes, 0);
});
