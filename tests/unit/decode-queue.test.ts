import test from 'node:test';
import assert from 'node:assert/strict';
import { DecodeQueue } from '../../src/assets/decode-queue';

test('byte admission retains cancelled native slots and admits oversized work alone', async () => {
  const queue = new DecodeQueue(3, 'closed', 10);
  const started: number[] = [];
  const first = Promise.withResolvers<void>();
  const large = Promise.withResolvers<void>();
  const signal = new AbortController();
  const a = queue.run(
    async () => {
      started.push(1);
      await first.promise;
    },
    signal.signal,
    7,
  );
  const b = queue.run(
    async () => {
      started.push(2);
      await large.promise;
    },
    undefined,
    12,
  );
  const c = queue.run(
    async () => {
      started.push(3);
    },
    undefined,
    2,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  signal.abort();
  assert.deepEqual(started, [1], 'Native work still owns its memory after cancellation');
  first.resolve();
  await a;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2], 'Oversized work is admitted, with no smaller peer');
  large.resolve();
  await Promise.all([b, c]);
  assert.deepEqual(started, [1, 2, 3]);
  queue.dispose();
});

test('cancelling a queued large image advances fitting work and disposal closes admission', async () => {
  const queue = new DecodeQueue(3, 'closed', 10);
  const first = Promise.withResolvers<void>();
  const a = queue.run(() => first.promise, undefined, 7);
  const signal = new AbortController();
  const b = queue.run(async () => {}, signal.signal, 7);
  const rejected = assert.rejects(b, /obsolete/);
  let smallStarted = false;
  const c = queue.run(
    async () => {
      smallStarted = true;
    },
    undefined,
    2,
  );
  signal.abort(new Error('obsolete'));
  await rejected;
  await c;
  assert.equal(smallStarted, true);
  queue.dispose();
  await assert.rejects(
    queue.run(async () => {}),
    /closed/,
  );
  first.resolve();
  await a;
});
