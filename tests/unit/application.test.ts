import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../src/application';
import { AssetRuntime, ResourcePool, type PackLease } from '../../src/assets/loader';
import { presentationFixture, sceneFixture } from '../fixtures/presentation';
import { content } from '../fixtures/content';
import type { Bridge } from '../../src/core/save';
import { Persistence } from '../../src/core/persistence';

async function withDOM(work: () => Promise<void>) {
  const previous = new Map(
    ['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of previous.keys())
    Object.defineProperty(globalThis, key, { configurable: true, value: new EventTarget() });
  try {
    await work();
  } finally {
    for (const [key, descriptor] of previous)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
}

test('resolved zero and empty resource handles dispose once and can be acquired again', async () => {
  for (const value of [0, undefined]) {
    let loaded = 0;
    const disposed: unknown[] = [],
      pool = new ResourcePool(
        async () => {
          loaded++;
          return value;
        },
        (value) => disposed.push(value),
      );
    const first = await pool.acquire(['handle', 'handle']);
    first.release();
    first.release();
    assert.deepEqual(disposed, [value]);
    assert.equal(pool.entries.size, 0);
    const second = await pool.acquire(['handle']);
    assert.equal(loaded, 2);
    second.release();
    assert.deepEqual(disposed, [value, value]);
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function fixture() {
  const app = new Application(
    { dataset: {} } as unknown as HTMLCanvasElement,
    content,
    {},
    {} as Bridge,
    sceneFixture(content),
    () => presentationFixture(),
    { status: () => {}, pause: () => {}, frame: () => {} },
  );
  let released = 0,
    warmed = 0;
  const lease = { release: () => released++ } as unknown as PackLease;
  app.presentation = presentationFixture({
    warmPack: () => {
      warmed++;
    },
  });
  return {
    app,
    lease,
    get released() {
      return released;
    },
    get warmed() {
      return warmed;
    },
  };
}
test('completed session operations preserve a pause requested while loading', async () => {
  for (const operation of [
    (app: Application) => app.reset(),
    (app: Application) => app.restore(app.session.captureSave()),
    (app: Application) => app.newGame(),
  ]) {
    const { app } = fixture(),
      waiting = deferred<void>();
    app.readOnly = true;
    app.replaceArea = async (_area, commit) => {
      await waiting.promise;
      commit();
    };
    app.pause(true);
    const pending = operation(app);
    app.pause(true);
    waiting.resolve();
    await pending;
    assert.equal(app.paused, true, 'A late completion must not dismiss a newly requested pause');
    await operation(app);
    assert.equal(app.paused, false, 'An unchanged foreground operation still resumes normally');
  }
});
test('checkpoint reading preserves later pause requests and background state, and disposal prevents late area acquisition', async () => {
  await withDOM(async () => {
    const { app } = fixture(),
      waiting = deferred<Awaited<ReturnType<Bridge['loadGame']>>>(),
      saved = app.session.captureSave();
    app.persistence = new Persistence({
      loadGame: () => waiting.promise,
      saveGame: async () => {},
    });
    let areas = 0;
    app.replaceArea = async (_area, commit) => {
      areas++;
      commit();
    };
    app.pause(true);
    const loading = app.load();
    app.pause(false);
    app.pause(true);
    waiting.resolve({ status: 'ok', data: saved });
    assert.equal(await loading, true);
    assert.equal(app.paused, true);
    const frames = { idle: true };
    (app as unknown as { frames: typeof frames }).frames = frames;
    await app.load();
    assert.equal(app.paused, true);
    frames.idle = false;
    await app.load();
    assert.equal(app.paused, false);
    assert.equal(areas, 3);

    const late = fixture().app,
      pending = deferred<Awaited<ReturnType<Bridge['loadGame']>>>();
    late.persistence = new Persistence({
      loadGame: () => pending.promise,
      saveGame: async () => {},
    });
    const request = late.load();
    late.dispose();
    pending.resolve({ status: 'ok', data: saved });
    await assert.rejects(request, /disposed/);
  });
});
test('gallery requests share one lease; disposal and failed warming release acquisitions', async () => {
  const f = fixture(),
    pending = deferred<PackLease>();
  let loads = 0;
  f.app.runtime = {
    loadPack: () => {
      loads++;
      return pending.promise;
    },
  } as unknown as AssetRuntime;
  const first = f.app.loadAsset('gallery'),
    second = f.app.loadAsset('gallery');
  pending.resolve(f.lease);
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.equal(f.warmed, 1);
  assert.equal(f.app.packs.get('gallery'), f.lease);
  await withDOM(async () => {
    f.app.dispose();
    f.app.dispose();
    assert.equal(f.released, 1);
    await assert.rejects(f.app.loadAsset('gallery'), /disposed/);
    const late = fixture(),
      wait = deferred<PackLease>();
    late.app.runtime = { loadPack: () => wait.promise } as unknown as AssetRuntime;
    const loading = late.app.loadAsset('gallery');
    late.app.dispose();
    wait.resolve(late.lease);
    await assert.rejects(loading, /disposed/);
    assert.equal(late.released, 1);
    assert.equal(late.warmed, 0);
    assert.equal(late.app.packs.size, 0);
    const failure = fixture();
    failure.app.runtime = { loadPack: async () => failure.lease } as unknown as AssetRuntime;
    failure.app.presentation.warmPack = () => {
      throw new Error('GPU unavailable');
    };
    await assert.rejects(failure.app.loadAsset('gallery'), /GPU unavailable/);
    assert.equal(failure.released, 1);
    failure.app.presentation.warmPack = () => {};
    await failure.app.loadAsset('gallery');
    assert.equal(failure.app.packs.size, 1);
    failure.app.dispose();
  });
});
test('startup disposed while opening its catalog cannot acquire assets or become ready', async () => {
  const f = fixture(),
    opening = deferred<AssetRuntime>(),
    // oxlint-disable-next-line typescript/unbound-method -- Saved for restoration, never invoked unbound.
    open = AssetRuntime.open;
  AssetRuntime.open = () => opening.promise;
  await withDOM(async () => {
    try {
      const boot = f.app.boot();
      f.app.dispose();
      opening.resolve({
        loadPack: () => {
          throw new Error('unexpected acquisition');
        },
      } as unknown as AssetRuntime);
      await assert.rejects(boot, /disposed/);
      assert.equal(f.app.ready, false);
      assert.equal(f.app.canvas.dataset.ready, undefined);
    } finally {
      AssetRuntime.open = open;
    }
  });
});

test('simulation enablement isolates lab policy, keeps rendering, and clears catch-up time', async () => {
  await withDOM(async () => {
    const { app } = fixture();
    Object.assign(app.bridge, { automatedRun: true });
    let steps = 0,
      renders = 0,
      lastRenderMs = 0;
    app.beforeStep = () => {
      steps++;
    };
    app.presentation = presentationFixture({
      update: (_sim: unknown, _alpha: number, ms: number) => {
        renders++;
        lastRenderMs = ms;
      },
      dispose: () => {},
    });
    app.input = {
      clear: () => {},
      consume: () => ({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } }),
      dispose: () => {},
    } as unknown as typeof app.input;
    const frame = Reflect.get(app, 'loop') as (now: number) => void;
    app.setSimulationEnabled(false);
    const tick = app.sim.tick;
    frame(performance.now() + 1000);
    assert.equal(app.sim.tick, tick);
    assert.equal(steps, 0);
    assert.equal(renders, 1);
    assert.ok(lastRenderMs > 0);
    app.setSimulationEnabled(true);
    assert.equal(app.clock.accumulator, 0);
    frame(performance.now() + 20);
    assert.equal(app.sim.tick, tick + 1);
    assert.equal(steps, 1);
    app.pause(true);
    frame(performance.now() + 1000);
    assert.equal(app.sim.tick, tick + 1);
    assert.equal(steps, 1);
    assert.equal(lastRenderMs, 0);
    app.dispose();
  });
});

test('overlapping loading scopes reveal a rendered destination only after every request settles', async () => {
  await withDOM(async () => {
    const { app } = fixture(),
      first = deferred<void>(),
      second = deferred<void>();
    const states: (boolean | string)[] = [];
    app.hooks.loading = (active) => states.push(active);
    app.ready = true;
    app.presentation.update = () => {
      states.push('render');
    };
    const a = app.withLoading(() => first.promise);
    const b = app.withLoading(() => second.promise);
    assert.deepEqual(states, [true]);
    first.resolve();
    await a;
    assert.deepEqual(states, [true], 'An old request must not reveal a newer pending load');
    second.resolve();
    await b;
    assert.deepEqual(states, [true, 'render', false]);
    await assert.rejects(
      app.withLoading(async () => {
        throw new Error('unavailable');
      }),
      /unavailable/,
    );
    assert.deepEqual(states.slice(-3), [true, 'render', false]);
    app.presentation.update = () => {
      throw new Error('destination render unavailable');
    };
    await assert.rejects(
      app.withLoading(async () => {}),
      /destination render unavailable/,
    );
    assert.deepEqual(states.slice(-2), [true, false], 'A failed render must release the overlay');
    const late = deferred<void>();
    const pending = app.withLoading(() => late.promise);
    app.dispose();
    const afterDispose = [...states];
    late.resolve();
    await pending;
    assert.deepEqual(
      states,
      afterDispose,
      'Late completion must not render or reopen a disposed screen',
    );
  });
});

test('checkpoint reading freezes gameplay and recovers loading state for empty saves and storage failures', async () => {
  await withDOM(async () => {
    const { app } = fixture(),
      waiting = deferred<Awaited<ReturnType<Bridge['loadGame']>>>();
    const states: boolean[] = [];
    app.hooks.loading = (active) => states.push(active);
    app.persistence = new Persistence({
      loadGame: () => waiting.promise,
      saveGame: async () => {},
    });
    Object.assign(app.bridge, { automatedRun: true });
    let steps = 0;
    app.beforeStep = () => {
      steps++;
    };
    app.presentation.update = () => {};
    const load = app.load();
    (app as unknown as { loop: (now: number) => void }).loop(performance.now() + 1000);
    assert.equal(steps, 0, 'Pending checkpoint reads must block commands before area acquisition');
    waiting.resolve({ status: 'empty' });
    assert.equal(await load, false);
    assert.deepEqual(states, [true, false]);
    app.persistence = new Persistence({
      loadGame: async () => {
        throw new Error('storage unavailable');
      },
      saveGame: async () => {},
    });
    await assert.rejects(app.load(), /storage unavailable/);
    assert.deepEqual(states, [true, false, true, false]);
  });
});

test('startup settles the initial asset batch and releases successful peers when any pack fails or boot is disposed', async () => {
  await withDOM(async () => {
    for (const cancelled of [false, true]) {
      const waiting = deferred<PackLease>(),
        requested: string[] = [];
      let released = 0;
      // oxlint-disable-next-line typescript/unbound-method -- Saved for restoration, never invoked unbound.
      const open = AssetRuntime.open;
      const app = new Application(
        { dataset: {} } as unknown as HTMLCanvasElement,
        content,
        { first: 'first', second: 'second' },
        {} as Bridge,
        { ...sceneFixture(content), initialAssets: ['first', 'second'] },
        () => presentationFixture(),
        { status: () => {}, pause: () => {}, frame: () => {} },
      );
      AssetRuntime.open = async () =>
        ({
          loadPack: async (id: string) => {
            requested.push(id);
            if (id === 'first') return waiting.promise;
            if (!cancelled) throw new Error('missing pack');
            return { release: () => released++ } as unknown as PackLease;
          },
        }) as unknown as AssetRuntime;
      try {
        const boot = app.boot();
        const rejected = assert.rejects(boot, cancelled ? /cancelled/ : /missing pack/);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.deepEqual(requested, ['first', 'second']);
        if (cancelled) app.dispose();
        waiting.resolve({ release: () => released++ } as unknown as PackLease);
        await rejected;
        assert.equal(released, cancelled ? 2 : 1);
        assert.equal(app.packs.size, 0);
        assert.equal(app.ready, false);
      } finally {
        app.dispose();
        AssetRuntime.open = open;
      }
    }
  });
});
