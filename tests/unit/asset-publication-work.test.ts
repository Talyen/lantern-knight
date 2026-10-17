import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationWork } from '../../tools/assets/publication-work';

test('failed publication stops admission and drains active transfers before staging can be released', async () => {
  const active = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
  const started: number[] = [];
  const admitted = Promise.withResolvers<void>();
  let settled = false;
  const work = publicationWork([0, 1, 2, 3, 4], async (value) => {
    started.push(value);
    if (started.length === 3) admitted.resolve();
    await active[value]!.promise;
  });
  const rejected = assert.rejects(work, /upload failed/).then(() => {
    settled = true;
  });
  await admitted.promise;
  active[0]!.reject(new Error('upload failed'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'the failed publisher must retain the other live transfers');
  active[1]!.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2], 'no further work may start after failure');
  active[2]!.resolve();
  await rejected;
});

test('successful publication visits each job once under its concurrency bound', async () => {
  let active = 0;
  let peak = 0;
  const visited = new Set<number>();
  await publicationWork(
    Array.from({ length: 20 }, (_, i) => i),
    async (value) => {
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      visited.add(value);
      active--;
    },
    2,
  );
  assert.equal(peak, 2);
  assert.equal(visited.size, 20);
});
