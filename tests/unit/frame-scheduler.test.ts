import test, { type TestContext } from 'node:test';
import { mockGlobals } from '../fixtures/globals';
import assert from 'node:assert/strict';
import { FrameScheduler } from '../../src/frame-scheduler';
import { Application } from '../../src/application';
import { AssetRuntime, type PackLease } from '../../src/assets/loader';
import { presentationFixture, sceneFixture } from '../fixtures/presentation';
import type { Bridge } from '../../src/platform/bridge';
import { content } from '../fixtures/content';

function environment(t: TestContext) {
  const win = new EventTarget(),
    doc = new EventTarget();
  let focused = true,
    hidden = false,
    now = 0,
    id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  Object.assign(doc, { hasFocus: () => focused });
  Object.defineProperty(doc, 'hidden', { get: () => hidden });
  mockGlobals(t, {
    window: win,
    document: doc,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      pending.set(++id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      pending.delete(id);
    },
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => now);
  return {
    win,
    doc,
    get pending() {
      return pending.size;
    },
    raf(ms = 16) {
      now += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(now));
    },
    time(ms: number) {
      now += ms;
      t.mock.timers.tick(ms);
    },
    blur() {
      focused = false;
      win.dispatchEvent(new Event('blur'));
    },
    focus() {
      focused = true;
      win.dispatchEvent(new Event('focus'));
    },
    hide() {
      hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      hidden = false;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

test('background cadence is bounded; focus resumes one loop and resets timing without catch-up', (t) => {
  const e = environment(t);
  let last = 0,
    draws = 0;
  const deltas: number[] = [];
  const frames = new FrameScheduler(
    (now) => {
      draws++;
      deltas.push(now - last);
      last = now;
    },
    () => (last = performance.now()),
  );
  e.raf();
  assert.deepEqual(deltas, [16]);
  e.blur();
  assert.equal(e.pending, 0);
  e.time(999);
  assert.equal(draws, 1);
  e.time(1);
  assert.equal(draws, 2);
  e.hide();
  e.time(1000);
  assert.equal(draws, 3);
  e.show();
  assert.equal(e.pending, 0);
  e.focus();
  e.focus();
  assert.equal(e.pending, 1);
  e.raf();
  assert.equal(deltas.at(-1), 16);
  frames.dispose();
  frames.dispose();
  e.raf();
  e.time(5000);
  assert.equal(draws, 4);
  assert.equal(e.pending, 0);
});

test('automated hidden and unfocused runs retain frame cadence; focus changes during drawing cannot duplicate loops', (t) => {
  const e = environment(t);
  e.blur();
  e.hide();
  let draws = 0;
  const frames = new FrameScheduler(
    () => {
      draws++;
      e.show();
      e.focus();
    },
    () => {},
    true,
  );
  e.raf();
  assert.equal(draws, 1);
  assert.equal(e.pending, 1);
  e.raf();
  assert.equal(draws, 2);
  frames.dispose();
  const normal = new FrameScheduler(
    () => {
      e.blur();
      e.focus();
    },
    () => {},
  );
  e.raf();
  assert.equal(e.pending, 1);
  normal.dispose();
});

test('background Application redraws cannot advance simulation, settings or checkpoints after an explicit unpause', (t) => {
  const e = environment(t);
  let saves = 0,
    frames = 0;
  const elapsed: number[] = [];
  const bridge = {
    saveGame: async () => {
      saves++;
    },
    saveSettings: async () => {
      saves++;
    },
  } as unknown as Bridge;
  const app = new Application(
    { dataset: {} } as HTMLCanvasElement,
    {},
    bridge,
    sceneFixture(content),
    () => presentationFixture(),
    { status: () => {}, pause: () => {}, frame: () => frames++ },
  );
  app.presentation = presentationFixture({
    update: (_sim: unknown, _alpha: number, ms: number) => elapsed.push(ms),
    dispose: () => {},
  });
  app.input = {
    clear: () => {},
    dispose: () => {},
    consume: () => {
      throw new Error('background consumed gameplay input');
    },
  } as unknown as Application['input'];
  const before = app.session.captureSave(),
    tick = app.sim.tick;
  // Exercise the real Application frame body with the same scheduler used at boot.
  const loop = (app as unknown as { loop: (now: number) => void }).loop;
  const scheduler = new FrameScheduler(loop, () => {}, false);
  (app as unknown as { frames: FrameScheduler }).frames = scheduler;
  // Native forwarding can emit blur while the DOM focus query remains true.
  e.win.dispatchEvent(new Event('blur'));
  app.pause(false);
  assert.equal(document.hasFocus(), true);
  assert.equal(e.pending, 0);
  e.time(1000);
  e.time(1000);
  assert.equal(frames, 2);
  assert.deepEqual(elapsed, [0, 0]);
  assert.equal(app.sim.tick, tick);
  assert.deepEqual(app.session.captureSave(), before);
  assert.equal(saves, 0);
  scheduler.dispose();
  app.dispose();
});

test('Application startup shares one resource graph and scheduler across concurrent and repeated callers', async (t) => {
  const e = environment(t);
  let opened = 0,
    created = 0,
    closed = 0;
  const runtime = new AssetRuntime({});
  t.mock.method(AssetRuntime, 'open', async () => {
    opened++;
    return runtime;
  });
  let joined: Promise<void> | undefined;
  const app = new Application(
    Object.assign(new EventTarget(), { dataset: {} }) as HTMLCanvasElement,
    {},
    { loadSettings: async () => ({ status: 'empty' }) } as Bridge,
    sceneFixture(content),
    () => {
      created++;
      return presentationFixture({ dispose: () => closed++ });
    },
    {
      status: () => {},
      pause: () => {},
      frame: () => {},
      loading: (active) => {
        if (active) joined = app.boot();
      },
    },
  );
  t.after(() => app.dispose());
  const first = app.boot();
  assert.equal(app.boot(), first);
  await first;
  assert.equal(joined, first, 'Reentrant loading feedback must join the same startup');
  assert.equal(app.boot(), first);
  await app.boot();
  assert.equal(opened, 1);
  assert.equal(created, 1);
  assert.equal(app.ready, true);
  assert.equal(app.canvas.dataset.ready, 'true');
  assert.equal(e.pending, 1);
  app.dispose();
  assert.equal(closed, 1);
  assert.equal(e.pending, 0);
  assert.equal(app.canvas.dataset.ready, undefined);
  await assert.rejects(app.boot(), /disposed/);
});

test('failed Application startup releases transferred assets and closes presentation without caller cleanup', async (t) => {
  const e = environment(t);
  let released = 0,
    closed = 0,
    runtimeClosed = 0;
  const runtime = new AssetRuntime({});
  t.mock.method(
    runtime,
    'loadPack',
    async () => ({ release: () => released++ }) as unknown as PackLease,
  );
  t.mock.method(runtime, 'dispose', () => runtimeClosed++);
  t.mock.method(AssetRuntime, 'open', async () => runtime);
  const failure = new Error('GPU preparation failed');
  const app = new Application(
    Object.assign(new EventTarget(), { dataset: {} }) as HTMLCanvasElement,
    {},
    { loadSettings: async () => ({ status: 'empty' }) } as Bridge,
    sceneFixture(content),
    () =>
      presentationFixture({
        warm: async () => {
          throw failure;
        },
        dispose: () => closed++,
      }),
    { status: () => {}, pause: () => {}, frame: () => {} },
    { extraAssets: ['startup'] },
  );
  t.after(() => app.dispose());
  const first = app.boot();
  await assert.rejects(first, (error) => error === failure);
  assert.equal(released, 1);
  assert.equal(closed, 1);
  assert.equal(runtimeClosed, 1);
  assert.equal(app.packs.size, 0);
  assert.equal(app.ready, false);
  assert.equal(e.pending, 0);
  // A failed lifetime cannot be resurrected with already-aborted resource owners.
  await assert.rejects(app.boot(), /disposed/);
  app.dispose();
  assert.equal(released, 1);
  assert.equal(closed, 1);
  assert.equal(runtimeClosed, 1);
});

test(
  'disposing Application startup stops waiting for host settings and discards late failures',
  { timeout: 2000 },
  async (t) => {
    const e = environment(t);
    let warmed = 0,
      closed = 0;
    const { promise: reading, resolve: requested } = Promise.withResolvers<void>();
    const { promise: settings, reject: rejectSettings } = Promise.withResolvers<never>();
    t.mock.method(AssetRuntime, 'open', async () => new AssetRuntime({}));
    const app = new Application(
      Object.assign(new EventTarget(), { dataset: {} }) as HTMLCanvasElement,
      {},
      {
        loadSettings: () => {
          requested();
          return settings;
        },
      } as unknown as Bridge,
      sceneFixture(content),
      () =>
        presentationFixture({
          warm: async () => {
            warmed++;
          },
          dispose: () => closed++,
        }),
      { status: () => {}, pause: () => {}, frame: () => {} },
    );
    t.after(() => app.dispose());
    const boot = app.boot();
    const rejected = assert.rejects(boot, /disposed/);
    await reading;
    app.dispose();
    await rejected;
    assert.equal(closed, 1);
    assert.equal(warmed, 0);
    assert.equal(e.pending, 0);
    rejectSettings(new Error('late storage failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(app.ready, false);
    assert.equal(app.settingsError, '', 'Late host results cannot modify the closed application');
  },
);
