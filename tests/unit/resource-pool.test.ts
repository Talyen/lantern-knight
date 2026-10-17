import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourcePool } from '../../src/assets/resource-pool';

// Assert which failures survive, without binding the test to AggregateError nesting.
function contains(error: unknown, expected: unknown): boolean {
  return (
    error === expected ||
    (error instanceof AggregateError && error.errors.some((item) => contains(item, expected)))
  );
}

test('pool leases share falsy resources, transfer settled ownership and release once', async () => {
  for (const value of [0, undefined]) {
    let loads = 0;
    const destroyed: unknown[] = [],
      pool = new ResourcePool(
        async () => {
          loads++;
          return value;
        },
        (value) => destroyed.push(value),
      ),
      controller = new AbortController();
    controller.abort();
    await assert.rejects(pool.acquire(['shared'], controller.signal), /cancelled/);
    assert.equal(loads, 0, 'Pre-cancelled requests cannot load');
    const [first, second] = await Promise.all([
      pool.acquire(['shared', 'shared']),
      pool.acquire(['shared']),
    ]);
    assert.equal(loads, 1);
    assert.equal(first.resources.size, 1);
    assert.equal(first.resources.get('shared'), value);
    first.release();
    first.release();
    assert.deepEqual(destroyed, []);
    second.release();
    assert.deepEqual(destroyed, [value]);
    const signal = new AbortController();
    const next = await pool.acquire(['shared'], signal.signal);
    signal.abort();
    assert.equal(loads, 2);
    assert.equal(pool.size, 1, 'Completed batches belong to the caller');
    next.release();
    assert.deepEqual(destroyed, [value, value]);
    assert.equal(pool.size, 0);
    pool.dispose();
  }
});

for (const closing of ['cancel', 'dispose'] as const) {
  test(`${closing} drains ready and late resources once even when a destructor fails`, async () => {
    const late = Promise.withResolvers<string>(),
      ready = Promise.withResolvers<void>(),
      controller = new AbortController(),
      destroyed: string[] = [],
      failure = new Error('texture cleanup'),
      pool = new ResourcePool(
        (id) => (id === 'late' ? late.promise : Promise.resolve(id)),
        (id) => {
          destroyed.push(id);
          if (id === 'broken') throw failure;
        },
      );
    const held = closing === 'dispose' ? await pool.acquire(['broken', 'peer']) : undefined;
    const pending = pool.acquire(['broken', 'peer', 'late'], controller.signal, (done) => {
      if (done === 2) ready.resolve();
    });
    const rejected = assert.rejects(pending, (error: unknown) => {
      if (closing === 'cancel') assert.ok(contains(error, failure));
      else assert.match(String(error), /disposed/);
      return true;
    });
    await ready.promise;
    if (closing === 'cancel') controller.abort();
    else
      assert.throws(
        () => pool.dispose(),
        (error) => error === failure,
      );
    assert.deepEqual(destroyed, ['broken', 'peer']);
    assert.equal(pool.size, 0, 'Claims retire before native work settles');
    late.resolve('late');
    await rejected;
    held?.release();
    pool.dispose();
    pool.dispose();
    assert.deepEqual(destroyed, ['broken', 'peer', 'late']);
    await assert.rejects(pool.acquire(['peer']), /disposed/);
  });
}

for (const synchronous of [false, true]) {
  test(`${synchronous ? 'synchronous' : 'asynchronous'} load failure drains late peers and permits a fresh retry`, async () => {
    const late = Promise.withResolvers<object>(),
      destroyed: object[] = [],
      value = {},
      failure = new Error('decode failed');
    let fail = true,
      settled = false;
    const pool = new ResourcePool(
      (id) => {
        if (id !== 'bad') return late.promise;
        if (!fail) return Promise.resolve(value);
        if (synchronous) throw failure;
        return Promise.reject(failure);
      },
      (value) => destroyed.push(value),
    );
    const rejected = assert.rejects(
      pool.acquire(['bad', 'late']).finally(() => {
        settled = true;
      }),
      (error) => error === failure,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'Failed acquisitions still observe native work through cleanup');
    assert.equal(pool.size, 0);
    late.resolve(value);
    await rejected;
    assert.deepEqual(destroyed, [value]);
    fail = false;
    (await pool.acquire(['bad'])).release();
    assert.deepEqual(destroyed, [value, value]);
    assert.equal(pool.size, 0);
    pool.dispose();
  });
}
