import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopShutdown } from '../../electron/shutdown';

test('desktop quit closes admission synchronously, joins repeated intent and resumes once drained', async () => {
  const draining = Promise.withResolvers<void>();
  let prevented = 0,
    closes = 0,
    quits = 0;
  const event = {
    preventDefault: () => {
      prevented++;
    },
  };
  const shutdown = new DesktopShutdown(
    () => {
      closes++;
      shutdown.request(event);
      return draining.promise;
    },
    () => {
      quits++;
      shutdown.request(event);
    },
  );
  assert.equal(shutdown.requested, false);
  shutdown.request(event);
  assert.equal(shutdown.requested, true);
  shutdown.request(event);
  assert.equal(closes, 1);
  assert.equal(prevented, 3);
  assert.equal(quits, 0);
  draining.resolve();
  await draining.promise;
  assert.equal(quits, 1);
  assert.equal(prevented, 3, 'The resumed Electron quit passes through the barrier');
});

test('failed desktop shutdown reports its error and permits subsequent quit', async (t) => {
  const errors: unknown[] = [];
  t.mock.method(console, 'error', (_message: string, error: unknown) => errors.push(error));
  for (const synchronous of [false, true]) {
    const failure = new Error('Storage drain failed');
    let prevented = 0,
      quits = 0;
    const event = {
      preventDefault: () => {
        prevented++;
      },
    };
    const shutdown = new DesktopShutdown(
      () => {
        if (synchronous) throw failure;
        return Promise.reject(failure);
      },
      () => {
        quits++;
        shutdown.request(event);
      },
    );
    shutdown.request(event);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(quits, 1);
    assert.equal(prevented, 1);
    assert.equal(errors.at(-1), failure);
  }
});
