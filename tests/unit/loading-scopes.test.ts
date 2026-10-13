import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadingScopes } from '../../src/loading-scopes';

test('cancelled loading retires admission while observing late work and preserving independent loads', async () => {
  const changes: boolean[] = [],
    errors: unknown[] = [],
    scopes = new LoadingScopes(
      () => changes.push(true),
      () => changes.push(false),
      (error) => errors.push(error),
    ),
    controller = new AbortController(),
    cancelledWork = Promise.withResolvers<void>(),
    independentWork = Promise.withResolvers<void>();
  const cancelled = scopes.run(() => cancelledWork.promise, controller.signal),
    rejected = assert.rejects(cancelled, /late failure/),
    independent = scopes.run(() => independentWork.promise);
  controller.abort();
  await Promise.resolve();
  assert.equal(scopes.busy, true);
  assert.deepEqual(changes, [true]);
  independentWork.resolve();
  await independent;
  assert.equal(scopes.busy, false);
  assert.deepEqual(changes, [true, false]);
  cancelledWork.reject(new Error('late failure'));
  await rejected;
  assert.deepEqual(changes, [true, false]);
  scopes.dispose();
  assert.deepEqual(errors, []);
});

test('cancelled scopes reveal without settlement and contain reveal failure; disposal closes reentrant admission', async () => {
  const errors: unknown[] = [],
    controller = new AbortController(),
    pending = Promise.withResolvers<void>(),
    scopes = new LoadingScopes(
      () => {},
      () => {
        throw new Error('reveal failed');
      },
      (error) => errors.push(error),
    );
  const draining = scopes.run(() => pending.promise, controller.signal);
  controller.abort();
  await Promise.resolve();
  assert.equal(scopes.busy, false);
  assert.match(String(errors[0]), /reveal failed/);
  scopes.dispose();
  pending.resolve();
  await draining;
  assert.equal(errors.length, 1);
  let closed!: LoadingScopes;
  closed = new LoadingScopes(
    () => closed.dispose(),
    assert.fail,
    (error) => errors.push(error),
  );
  await assert.rejects(
    closed.run(async () => assert.fail('work after disposal')),
    /disposed/,
  );
  await assert.rejects(
    closed.run(async () => {}),
    /disposed/,
  );
});
