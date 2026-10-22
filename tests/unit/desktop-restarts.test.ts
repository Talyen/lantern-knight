import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { desktopRestarts } from '../../tools/desktop-dev';

test('rebuilds during Electron shutdown launch only one replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const starts: AbortSignal[] = [];
  const restarts = desktopRestarts(async (signal) => {
    starts.push(signal);
    await (starts.length === 1 ? first.promise : starts.length === 2 ? second.promise : undefined);
  });
  t.after(async () => {
    first.resolve();
    second.resolve();
    await restarts.close();
  });
  const rebuild = async () => {
    restarts.building('main');
    restarts.built('main');
    t.mock.timers.tick(100);
    await setImmediate();
  };
  restarts.built('preload');
  await rebuild();
  assert.equal(starts.length, 1);
  await rebuild();
  await rebuild();
  assert.equal(starts[0]!.aborted, true);
  assert.equal(starts.length, 1, 'replacement waits for the old process to stop');
  first.resolve();
  await setImmediate();
  assert.equal(starts.length, 2);
  second.resolve();
  await setImmediate();
  assert.equal(starts.length, 2, 'obsolete rebuild must not launch after the replacement exits');
});

test('closing cancels pending restarts and drains the active process', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0;
  const restarts = desktopRestarts(async (signal) => {
    starts++;
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
  });
  restarts.built('main');
  restarts.built('preload');
  t.mock.timers.tick(100);
  await setImmediate();
  restarts.building('main');
  restarts.built('main');
  await restarts.close();
  restarts.built('main');
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(starts, 1);
});

test('a rebuilding or failed bundle invalidates scheduled and queued launches until repaired', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped = Promise.withResolvers<void>();
  const starts: AbortSignal[] = [];
  const restarts = desktopRestarts(async (signal) => {
    starts.push(signal);
    if (starts.length === 1) await stopped.promise;
  });
  t.after(async () => {
    stopped.resolve();
    await restarts.close();
  });
  restarts.built('main');
  restarts.built('preload');
  restarts.building('main');
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(starts.length, 0, 'initial launch requires both current bundles');
  restarts.built('main');
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(starts.length, 1);
  restarts.building('main');
  restarts.built('main');
  t.mock.timers.tick(100);
  assert.equal(starts[0]!.aborted, true);
  // Preload fails while the previous Electron process is still draining.
  restarts.building('preload');
  restarts.building('main');
  restarts.built('main');
  stopped.resolve();
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(starts.length, 1, 'a successful main rebuild cannot reuse failed preload readiness');
  restarts.built('preload');
  t.mock.timers.tick(100);
  await setImmediate();
  assert.equal(starts.length, 2, 'repairing preload admits the latest complete build');
});
