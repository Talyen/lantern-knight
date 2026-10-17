import { forgeFixture, supplyForge } from '../fixtures/forge';
import type { GameSave } from '../../src/core/save';
import { onExit } from '../../tools/scope-exit';
import { mockGlobals } from '../fixtures/globals';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../src/application';
import { AssetRuntime, type PackLease } from '../../src/assets/loader';
import { presentationFixture, sceneFixture } from '../fixtures/presentation';
import { content, contentDefinitions } from '../fixtures/content';
import { ContentRegistry } from '../../src/content/world';
import type { Bridge } from '../../src/platform/bridge';
import type { Simulation } from '../../src/core/simulation';
import { GameSession } from '../../src/core/session';
import { manifestFixture } from '../fixtures/manifest';
import { tuning } from '../../src/content/gameplay';

beforeEach((t) => {
  assert.ok('after' in t);
  mockGlobals(t, { window: new EventTarget(), document: new EventTarget() });
});

function runtime(loadPack: AssetRuntime['loadPack']) {
  return Object.assign(new AssetRuntime({}), { loadPack });
}
function fixture(scenes = sceneFixture(content), bridge: Partial<Bridge> = {}) {
  const app = new Application(
    { dataset: {} } as unknown as HTMLCanvasElement,
    {},
    {
      loadGame: async () => ({ status: 'empty' }),
      loadSettings: async () => ({ status: 'empty' }),
      saveGame: async () => {},
      saveSettings: async () => {},
      ...bridge,
    },
    scenes,
    () => presentationFixture(),
    { status: () => {}, pause: () => {}, frame: () => {} },
  );
  app.input = { clear() {}, resetAim() {}, dispose() {} } as unknown as typeof app.input;
  app.runtime = runtime(async () => assert.fail('fixture requires no packs'));
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
// Test setup uses the same explicit developer capability as preview hosts.
function editFixture(app: Application, work: (sim: Simulation) => undefined) {
  const readOnly = app.readOnly;
  app.readOnly = true;
  using _scopeExit1 = onExit(() => {
    app.readOnly = readOnly;
  });
  app.editPreview(work);
}
test('inventory commands save accepted changes once and leave no-ops and rejected commands inert', async () => {
  const writes: GameSave[] = [];
  const { app } = fixture(undefined, {
    saveGame: async (save) => {
      writes.push(save);
    },
  });
  const save = app.session.captureSave();
  delete save.adventure!.pack;
  Object.assign(save.adventure!.inventory, { 'orchard-ring': 1, 'damaged-axe': 2 });
  await app.restore(save);
  const changes = () => app.events.history.filter((event) => event.kind === 'inventory-changed');
  app.changeInventory({ kind: 'equip', item: 'orchard-ring', slot: 'ring1' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.adventure!.equipment.ring1, 'orchard-ring');
  app.changeInventory({ kind: 'equip', item: 'orchard-ring', slot: 'ring1' });
  app.changeInventory({ kind: 'unequip', slot: 'ring2' });
  app.changeInventory({ kind: 'salvage', item: 'iron' });
  assert.throws(
    () => app.changeInventory({ kind: 'equip', item: 'orchard-ring', slot: 'ring2' }),
    /not owned/,
  );
  assert.equal(writes.length, 1);
  assert.equal(changes().length, 1);
  app.changeInventory({ kind: 'salvage', item: 'damaged-axe' });
  app.changeInventory({ kind: 'salvage', item: 'damaged-axe' });
  assert.equal(writes.length, 2);
  assert.equal(writes[1]!.adventure!.inventory.iron, 4);
  assert.equal(changes().length, 2);
  app.dispose();
});
test('interacting with a different stack cancels a pending label pickup route', () => {
  const { app } = fixture();
  app.readOnly = true;
  editFixture(app, (sim) => {
    sim.drops.push(
      {
        id: 'far',
        source: 'test',
        enemy: false,
        x: 3,
        z: 5,
        rewards: [{ item: 'gold', amount: 1 }],
      },
      {
        id: 'near',
        source: 'test',
        enemy: false,
        x: 0,
        z: 6,
        rewards: [{ item: 'gold', amount: 2 }],
      },
    );
  });
  app.requestPickup('far');
  assert.equal(app.sim.navigationDebug(false).routes.length, 1);
  app.highlightedDrop = 'near';
  app.interact();
  assert.deepEqual(
    app.sim.drops.map((d) => d.id),
    ['far'],
  );
  assert.equal(app.sim.navigationDebug(false).routes.length, 0);
  app.dispose();
});

test('session replacement uses its own registry and complete scene asset requirements', async () => {
  const { app } = fixture(),
    definitions = structuredClone(contentDefinitions);
  assert.equal('resetCurrentArea' in app.session, false);
  assert.equal('sim' in app.session, false);
  // oxlint-disable-next-line no-constant-condition -- Compile-only session ownership checks.
  if (false) {
    // @ts-expect-error Room replacement belongs to Application.
    app.session.resetCurrentArea();
    // @ts-expect-error Inspection cannot replace the active simulation.
    app.session.sim = new GameSession(content).sim;
    // @ts-expect-error Preview overrides cannot change room identity.
    app.sim.area = 'upper-landing';
    // @ts-expect-error Preview overrides cannot forge session generations.
    app.sim.generation++;
    // @ts-expect-error Preparation must finish before resource acquisition starts.
    await app.replaceSession(app.scenes, { kind: 'new', prepare: async () => {} });
  }
  app.readOnly = true;
  definitions.areas[0]!.spawns = [
    { ...definitions.areas[0]!.spawns[0]!, id: 'replacement-target' },
  ];
  const registry = new ContentRegistry(definitions),
    scenes = {
      ...sceneFixture(registry),
      initialAssets: ['replacement-hero'],
      area: (id: string) => ({ area: registry.area(id), assets: ['replacement-enemy'] }),
    },
    snapshot = new GameSession(registry).captureSave(),
    delivered: string[] = [],
    requested: string[] = [];
  app.events.subscribe((event) => {
    assert.equal(app.roomReady, true, 'Replacement feedback waits for room acceptance');
    assert.equal(app.registry, registry);
    delivered.push(event.kind);
  });
  app.runtime = runtime(async (id) => {
    requested.push(id);
    return { release: () => {} } as unknown as PackLease;
  });
  app.presentation.resetRoom = (area) => {
    assert.equal(area, registry.area(snapshot.area));
    assert.deepEqual([...app.packs.keys()], ['replacement-hero', 'replacement-enemy']);
  };
  await app.replaceSession(scenes, { kind: 'save', save: snapshot });
  assert.deepEqual(requested, [...scenes.initialAssets, 'replacement-enemy']);
  assert.deepEqual(delivered, ['area-transition']);
  assert.equal(app.registry, registry);
  assert.equal(app.scenes, scenes);
  await app.restore(app.session.captureSave());
  assert.equal(app.sim.enemies[0]!.id.endsWith('/replacement-target'), true);
  await app.newGame();
  assert.equal(app.registry, registry);
  assert.equal(app.sim.enemies[0]!.id.endsWith('/replacement-target'), true);
  app.dispose();
});
test('replacement admission validates content and snapshots checkpoints before acquisition', async () => {
  const { app } = fixture(),
    previous = app.session,
    registry = new ContentRegistry(contentDefinitions),
    scenes = { ...sceneFixture(registry), initialAssets: ['candidate'] },
    snapshot = new GameSession(registry).captureSave(),
    preparing = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>();
  let acquisitions = 0,
    releases = 0;
  app.runtime = runtime(async () => {
    acquisitions++;
    return { release: () => releases++ } as unknown as PackLease;
  });
  await assert.rejects(app.replaceSession(scenes), /read-only/);
  app.readOnly = true;
  await assert.rejects(
    app.replaceSession(scenes, { kind: 'save', save: { ...snapshot, area: 'missing' } }),
    /unknown area/,
  );
  await assert.rejects(
    app.replaceSession(scenes, {
      kind: 'new',
      prepare: () => {
        throw new Error('preparation failed');
      },
    }),
    /preparation failed/,
  );
  assert.equal(acquisitions, 0, 'Rejected content must not start acquisition');
  assert.equal(app.session, previous);
  app.presentation.prepareAssets = async () => {
    preparing.resolve();
    await resume.promise;
  };
  const replacement = app.replaceSession(scenes, { kind: 'save', save: snapshot });
  await preparing.promise;
  snapshot.player.health = 0;
  snapshot.area = 'missing';
  resume.resolve();
  await replacement;
  assert.equal(app.session.generation, previous.generation + 1);
  assert.equal(app.sim.hero.health, app.sim.hero.definition.maxHealth);
  assert.equal(app.sim.area, registry.definitions.initialArea);
  assert.equal(app.roomReady, true);
  assert.equal(releases, 0);
  app.dispose();
  assert.equal(releases, 1);
});
test('renderer failure after a content switch recovers with the committed registry and asset source', async () => {
  const { app } = fixture(),
    registry = new ContentRegistry(contentDefinitions),
    scenes = { ...sceneFixture(registry), initialAssets: ['replacement'] },
    previous = app.session;
  let releases = 0;
  app.readOnly = true;
  app.runtime = runtime(async () => ({ release: () => releases++ }) as unknown as PackLease);
  app.presentation.resetRoom = () => {
    throw new Error('renderer failed');
  };
  await assert.rejects(app.replaceSession(scenes, { kind: 'new', seed: 903 }), /renderer failed/);
  assert.notEqual(app.session, previous);
  assert.equal(app.session.generation, previous.generation + 1);
  assert.equal(app.scenes, scenes);
  assert.equal(app.roomReady, false);
  assert.equal(releases, 0, 'The partially rebuilt renderer still owns the replacement pack');
  app.presentation.resetRoom = (area) => assert.equal(area, registry.area(area.id));
  await app.reset();
  assert.equal(app.roomReady, true);
  assert.equal(app.registry, registry);
  assert.equal(app.sim.initialSeed, 903);
  assert.equal(releases, 1);
  app.dispose();
  assert.equal(releases, 2);
});
test('safe reports synchronous callback failures without escaping the caller', async () => {
  const { app } = fixture();
  const reported = Promise.withResolvers<string>();
  app.hooks.status = (message) => reported.resolve(message);
  assert.doesNotThrow(() =>
    app.safe(() => {
      throw new Error('synchronous failure');
    }),
  );
  assert.equal(await reported.promise, 'synchronous failure');
  app.dispose();
});

test('null save rejections retain the original failure and reach application feedback', async () => {
  const { app } = fixture();
  const reported = Promise.withResolvers<string>();
  app.hooks.status = (message) => reported.resolve(message);
  Object.assign(app.bridge, {
    loadGame: async () => ({ status: 'empty' }),
    saveGame: () => Promise.reject(null),
  });
  const saving = app.save();
  await assert.rejects(saving, (error: unknown) => error === null);
  assert.equal(app.persistence.error, 'null');
  app.safe(() => saving);
  assert.equal(await reported.promise, 'null');
  app.dispose();
});

test('shutdown revokes retained checkpoint and settings commands before cleanup callbacks', async () => {
  const writes: string[] = [],
    { app } = fixture(sceneFixture(content), {
      loadGame: async () => ({ status: 'empty' }),
      loadSettings: async () => ({ status: 'empty' }),
      saveGame: async () => {
        writes.push('game');
      },
      saveSettings: async () => {
        writes.push('settings');
      },
    }),
    save = () => app.save(),
    settings = () => app.saveSettings(),
    autosave = () => app.autosave();
  assert.equal(Object.isFrozen(app.persistence), true);
  assert.equal('save' in app.persistence, false);
  assert.equal('load' in app.persistence, false);
  // oxlint-disable-next-line no-constant-condition -- Compile-only ownership checks.
  if (false) {
    // @ts-expect-error Hosts inspect feedback, never borrow storage commands.
    app.persistence.save(app.session.captureSave());
    // @ts-expect-error Hosts cannot replace the persistence owner.
    app.persistence = { error: '' };
  }
  let reentrant: Promise<void> | undefined;
  app.presentation.dispose = () => {
    reentrant = settings();
    autosave();
  };
  app.dispose();
  await assert.rejects(reentrant!, /disposed/);
  await assert.rejects(save(), /disposed/);
  await assert.rejects(settings(), /disposed/);
  autosave();
  assert.deepEqual(writes, []);
});

test(
  'shutdown stops a pending manual save before it can submit settings or late feedback',
  { timeout: 1000 },
  async () => {
    for (const fail of [false, true]) {
      const pending = Promise.withResolvers<void>(),
        writes: string[] = [],
        statuses: string[] = [],
        { app } = fixture(sceneFixture(content), {
          loadGame: async () => ({ status: 'empty' }),
          loadSettings: async () => ({ status: 'empty' }),
          saveGame: () => {
            writes.push('game');
            return pending.promise;
          },
          saveSettings: async () => {
            writes.push('settings');
          },
        });
      app.hooks.status = (message) => statuses.push(message);
      const saving = app.save(),
        closed = assert.rejects(saving, /disposed/);
      app.safe(() => saving);
      assert.deepEqual(writes, ['game']);
      app.dispose();
      // Disposal settles the caller even if the adapter never completes. Already
      // admitted writes remain owned and ordered by that adapter.
      await closed;
      if (fail) pending.reject(new Error('late disk failure'));
      else pending.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(writes, ['game']);
      assert.equal(app.persistence.error, '');
      assert.deepEqual(statuses, []);
    }
  },
);

test('shutdown discards pending settings feedback and synchronous transport reentry', async () => {
  const pending = Promise.withResolvers<void>(),
    statuses: string[] = [],
    { app } = fixture(sceneFixture(content), { saveSettings: () => pending.promise });
  app.hooks.status = (message) => statuses.push(message);
  app.settingsError = 'existing diagnostic';
  const saving = app.saveSettings(),
    closed = assert.rejects(saving, /disposed/);
  app.safe(() => saving);
  app.dispose();
  await closed;
  pending.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(app.settingsError, 'existing diagnostic');
  assert.deepEqual(statuses, []);
  let called = false;
  app.safe(async () => {
    called = true;
  });
  assert.equal(called, false);

  const reentrant = fixture().app;
  reentrant.bridge.saveGame = () => {
    reentrant.dispose();
    return Promise.reject(new Error('obsolete transport failure'));
  };
  await assert.rejects(reentrant.save(), /disposed/);
  assert.equal(reentrant.persistence.error, '');
});

test('preview replacement preserves shared assets and retains partially failed selections', async () => {
  const { app } = fixture(),
    released: PackLease[] = [],
    loaded: PackLease[] = [];
  app.runtime = runtime(async (id) => {
    const pack: PackLease = {
      manifest: manifestFixture(id),
      textures: new Map(),
      release: () => released.push(pack),
    };
    loaded.push(pack);
    return pack;
  });
  await app.retainAsset('shared');
  await app.previewAsset('shared', () => {
    assert.equal(app.packs.get('shared'), loaded[1]);
  });
  await app.previewAsset('second', () => {});
  assert.deepEqual([...app.packs.keys()], ['shared', 'second']);
  assert.equal(app.packs.get('shared'), loaded[0]);
  assert.deepEqual(released, [loaded[1]]);
  await assert.rejects(
    app.previewAsset('bad', () => {
      throw new Error('selection failed');
    }),
    /selection failed/,
  );
  assert.equal(app.packs.get('bad'), loaded[3]);
  assert.equal(
    app.packs.get('second'),
    loaded[2],
    'A rolled-back renderer can still resolve its pack',
  );
  assert.deepEqual(released, [loaded[1]], 'Failed selection may still borrow either batch');
  app.dispose();
  app.dispose();
  assert.deepEqual(released, [loaded[1], loaded[2], loaded[3], loaded[0]]);
  assert.equal(app.packs.size, 0);
});
test('stale previews release their lease without selecting or warming; disposal rejects late acquisitions', async () => {
  const f = fixture(),
    slow = Promise.withResolvers<PackLease>(),
    late = Promise.withResolvers<PackLease>();
  let staleReleased = 0,
    lateReleased = 0;
  f.app.runtime = runtime((id) =>
    id === 'slow' ? slow.promise : id === 'late' ? late.promise : Promise.resolve(f.lease),
  );
  const stale = f.app.previewAsset('slow', () => assert.fail('stale selection'));
  assert.equal(await f.app.previewAsset('fast', () => {}), true);
  slow.resolve({ release: () => staleReleased++ } as unknown as PackLease);
  assert.equal(await stale, false);
  assert.equal(staleReleased, 1);
  assert.equal(f.warmed, 1);
  assert.equal(f.app.packs.get('fast'), f.lease);
  const pending = f.app.previewAsset('late', () => assert.fail('disposed selection'));
  let cancelled = false;
  const rejected = assert.rejects(pending, /disposed/).then(() => {
    cancelled = true;
  });
  f.app.dispose();
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cancelled, true, 'Shutdown settles the command before acquisition drains');
    assert.equal(lateReleased, 0);
  } finally {
    late.resolve({ release: () => lateReleased++ } as unknown as PackLease);
    await rejected;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(lateReleased, 1);
  assert.equal(f.released, 1);
  assert.equal(f.warmed, 1);
  assert.equal(f.app.packs.size, 0);
});
test('superseded previews retire loading before obsolete transport settles', async () => {
  const { app, lease } = fixture(),
    slow = Promise.withResolvers<PackLease>(),
    loading: boolean[] = [];
  app.hooks.loading = (active) => loading.push(active);
  app.runtime = runtime((id) => (id === 'slow' ? slow.promise : Promise.resolve(lease)));
  let released = 0;
  let obsoleteResult: boolean | undefined;
  const stale = app
    .previewAsset('slow', () => assert.fail('obsolete selection'))
    .then((result) => {
      obsoleteResult = result;
    });
  try {
    assert.equal(await app.previewAsset('fast', () => {}), true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(obsoleteResult, false, 'Supersession settles the obsolete caller immediately');
    assert.equal(released, 0, 'The unfinished acquisition still owns its late result');
    assert.equal(loading.at(-1), false, 'Only the current selection may block interaction');
  } finally {
    slow.resolve({ release: () => released++ } as unknown as PackLease);
    await stale;
    await new Promise<void>((resolve) => setImmediate(resolve));
    app.dispose();
  }
  assert.equal(released, 1);
});
test('preview callbacks cannot install released leases after shutdown', async () => {
  for (const phase of ['warm', 'select']) {
    const { app, lease } = fixture();
    let releases = 0;
    lease.release = () => releases++;
    app.runtime = runtime(async () => lease);
    if (phase === 'warm') app.presentation.warmPack = () => app.dispose();
    await assert.rejects(
      app.previewAsset('candidate', () => {
        if (phase === 'select') app.dispose();
      }),
      /disposed/,
    );
    assert.equal(releases, 1);
    assert.equal(app.packs.size, 0);
  }
});
test('preview callback failure retains every borrowed batch until a successful successor', async () => {
  const { app } = fixture(),
    released: string[] = [];
  app.runtime = runtime(
    async (id) =>
      ({
        release: () => {
          released.push(id);
        },
      }) as unknown as PackLease,
  );
  await app.previewAsset('source', () => {});
  let borrowed: PackLease | undefined;
  await assert.rejects(
    app.previewAsset('partial', () => {
      borrowed = app.packs.get('partial') as PackLease;
      throw new Error('Renderer adopted the candidate then failed');
    }),
    /adopted/,
  );
  assert.ok(borrowed);
  assert.equal(app.packs.has('source'), true);
  assert.equal(app.packs.has('partial'), true);
  assert.deepEqual(released, []);
  await app.previewAsset('successor', () => {
    assert.deepEqual(released, [], 'Rebuild completes before prior borrows retire');
  });
  assert.deepEqual(released, ['source', 'partial']);
  app.dispose();
  assert.deepEqual(released, ['source', 'partial', 'successor']);
});

test('a selection submitted from loading feedback supersedes the admitting preview', async () => {
  const { app, lease } = fixture();
  const requested: string[] = [];
  app.runtime = runtime(async (id) => {
    requested.push(id);
    return lease;
  });
  let successor: Promise<boolean> | undefined;
  app.hooks.loading = (active) => {
    if (active && !successor) successor = app.previewAsset('successor', () => {});
  };
  assert.equal(await app.previewAsset('obsolete', () => assert.fail('obsolete selection')), false);
  assert.equal(await successor, true);
  assert.deepEqual(requested, ['successor']);
  app.dispose();
});
test('completed session operations preserve a pause requested while loading', async () => {
  for (const operation of [
    (app: Application) => app.reset(),
    (app: Application) => app.restore(app.session.captureSave()),
    (app: Application) => app.newGame(),
  ]) {
    const { app } = fixture(),
      waiting = Promise.withResolvers<void>();
    app.readOnly = true;
    app.ready = true;
    app.presentation.update = (view) => {
      assert.equal(view, app.sim, 'The renderer receives the current simulation facade');
      assert.equal('step' in view, false, 'Rendering cannot advance the simulation');
    };
    app.presentation.prepareAssets = () => waiting.promise;
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
  const { app } = fixture(),
    waiting = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>(),
    saved = app.session.captureSave();
  Object.assign(app.bridge, {
    loadGame: () => waiting.promise,
    saveGame: async () => {},
  });
  let areas = 0;
  app.presentation.resetRoom = () => {
    areas++;
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
    pending = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>();
  Object.assign(late.bridge, {
    loadGame: () => pending.promise,
    saveGame: async () => {},
  });
  const request = late.load();
  late.dispose();
  pending.resolve({ status: 'ok', data: saved });
  await assert.rejects(request, /disposed/);
});
test('newer session intent supersedes checkpoint reads before room acquisition', async () => {
  const { app } = fixture(),
    waiting = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>(),
    saved = new GameSession(content, 142, 'upper-landing').captureSave();
  app.readOnly = true;
  app.input = { clear() {}, resetAim() {}, dispose() {} } as unknown as typeof app.input;
  app.runtime = runtime(async () => assert.fail('fixture requires no packs'));
  Object.assign(app.bridge, {
    loadGame: () => waiting.promise,
    saveGame: async () => {},
  });
  const loading = app.load();
  const rejected = assert.rejects(loading, /superseded/);
  await app.newGame();
  const newest = app.sim;
  await rejected;
  waiting.resolve({ status: 'ok', data: saved });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(app.sim, newest, 'Late checkpoint data must not replace the new game');
  assert.equal(app.busy, false);

  const writing = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>();
  app.readOnly = false;
  Object.assign(app.bridge, {
    loadGame: async () => ({ status: 'empty' }),
    saveGame: () => {
      started.resolve();
      return writing.promise;
    },
  });
  const starting = app.newGame();
  const cancelled = assert.rejects(starting, /superseded/);
  await started.promise;
  await app.restore(saved);
  app.pause(true);
  writing.resolve();
  await cancelled;
  assert.equal(app.sim.area, saved.area);
  assert.equal(app.paused, true, 'An obsolete save completion cannot resume a newer session');
  app.dispose();
});
test('superseded transitions release late rooms without pausing or freezing the newer session', async () => {
  const { app } = fixture({
      ...sceneFixture(content),
      area: (id) => ({ area: content.area(id), assets: [id] }),
    }),
    waiting = Promise.withResolvers<PackLease>(),
    checkpoint = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>();
  editFixture(app, (sim) => {
    sim.cleared = true;
  });
  const exit = app.sim.areaDefinition.exits[0]!;
  assert.ok(exit);
  let released = 0;
  const statuses: string[] = [];
  app.hooks.status = (message) => statuses.push(message);
  app.runtime = runtime(() => waiting.promise);
  Object.assign(app.bridge, {
    loadGame: () => checkpoint.promise,
    saveGame: async () => {},
  });
  const original = app.sim;
  const transition = app.transition(exit.id);
  const rejected = assert.rejects(transition, /superseded/);
  assert.equal(app.session.loading, true);
  const latest = app.load();
  assert.equal(
    app.session.loading,
    false,
    'Supersession must cancel the plan before assets settle',
  );
  waiting.resolve({ release: () => released++ } as unknown as PackLease);
  await rejected;
  assert.equal(app.sim, original);
  assert.equal(
    app.paused,
    false,
    'An obsolete transition failure must not pause the latest session',
  );
  assert.equal(released, 1);
  assert.equal(app.busy, true, 'Old cleanup must preserve the latest operation ownership');
  checkpoint.resolve({ status: 'empty' });
  assert.equal(await latest, false);
  assert.equal(app.busy, false);
  app.safe(() => transition);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, [], 'Expected supersession must not surface as an error');
  app.dispose();
});

test('a recovered room can play while an obsolete asset acquisition still drains', async () => {
  const { app } = fixture({
      ...sceneFixture(content),
      area: (id) => ({ area: content.area(id), assets: [id] }),
    }),
    waiting = Promise.withResolvers<PackLease>();
  Object.assign(app.bridge, { automatedRun: true });
  app.readOnly = true;
  app.ready = true;
  editFixture(app, (sim) => {
    sim.cleared = true;
  });
  let released = 0,
    requests = 0,
    clears = 0;
  app.input.clear = () => {
    clears++;
  };
  const loading: boolean[] = [];
  app.hooks.loading = (active) => loading.push(active);
  app.runtime = runtime(async () => {
    if (++requests === 1) return waiting.promise;
    return { release() {} } as unknown as PackLease;
  });
  const transition = app.transition(app.sim.areaDefinition.exits[0]!.id);
  let cancelled = false;
  const rejected = assert.rejects(transition, /superseded/).then(() => {
    cancelled = true;
  });
  await app.newGame();
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cancelled, true, 'The obsolete command cannot wait for an uncancellable decode');
    assert.equal(released, 0);
    assert.equal(app.roomReady, true);
    assert.equal(app.busy, false);
    assert.deepEqual(loading, [true, false], 'Only the current load owns the overlay');
    app.command = () => ({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } });
    const tick = app.sim.tick;
    const frame = Reflect.get(app, 'loop') as (now: number) => void;
    frame(performance.now() + 100);
    assert.ok(app.sim.tick > tick, 'Late cancelled decodes cannot freeze accepted gameplay');
  } finally {
    waiting.resolve({ release: () => released++ } as unknown as PackLease);
    const beforeDrain = clears;
    await rejected;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(clears, beforeDrain, 'Late cleanup cannot erase newly accepted input');
    assert.deepEqual(loading, [true, false], 'Late cleanup cannot repeat loading feedback');
    app.dispose();
  }
  assert.equal(released, 1, 'Draining still owns and releases the late asset exactly once');
});

test('cancellation feedback can supersede the operation that triggered cancellation', async () => {
  const { app } = fixture({
      ...sceneFixture(content),
      area: (id) => ({
        area: content.area(id),
        assets: id === 'upper-landing' ? ['destination'] : [],
      }),
    }),
    room = Promise.withResolvers<PackLease>(),
    checkpoint = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>();
  editFixture(app, (sim) => {
    sim.cleared = true;
  });
  const original = app.sim;
  let released = 0,
    saves = 0;
  app.runtime = runtime(() => room.promise);
  Object.assign(app.bridge, {
    loadGame: () => checkpoint.promise,
    saveGame: async () => {
      saves++;
    },
  });
  let latest: Promise<boolean> | undefined;
  app.events.subscribe((event) => {
    if (event.kind === 'transition-cancelled') {
      latest = app.load();
      void latest.catch(() => {});
    }
  });
  const transition = app.transition(app.sim.areaDefinition.exits[0]!.id),
    cancelled = assert.rejects(transition, /superseded/),
    replacement = app.newGame(),
    result = await Promise.allSettled([replacement]);
  room.resolve({ release: () => released++ } as unknown as PackLease);
  await cancelled;
  assert.equal(result[0]!.status, 'rejected', 'The reentrant Load is the newest intent');
  assert.equal(app.sim, original, 'Superseded New Game must never commit');
  assert.equal(saves, 0, 'Superseded New Game must never overwrite the checkpoint');
  assert.equal(app.busy, true, 'Pending Load must retain operation ownership');
  assert.equal(released, 1, 'The obsolete transition still releases its late pack');
  checkpoint.resolve({ status: 'empty' });
  assert.equal(await latest, false);
  assert.equal(app.busy, false);
  app.dispose();
});

test('disposal during cancellation closes admission before another operation can be installed', async () => {
  const { app } = fixture({
      ...sceneFixture(content),
      area: (id) => ({ area: content.area(id), assets: ['pending-room'] }),
    }),
    room = Promise.withResolvers<PackLease>();
  app.readOnly = true;
  editFixture(app, (sim) => {
    sim.cleared = true;
  });
  let released = 0;
  app.runtime = runtime(() => room.promise);
  app.events.subscribe((event) => {
    if (event.kind === 'transition-cancelled') app.dispose();
  });
  const transition = app.transition(app.sim.areaDefinition.exits[0]!.id),
    cancelled = assert.rejects(transition, /superseded/);
  await assert.rejects(app.newGame(), /disposed/);
  room.resolve({ release: () => released++ } as unknown as PackLease);
  await cancelled;
  assert.equal(app.busy, false, 'Disposed application cannot retain a newly installed operation');
  assert.equal(released, 1);
});

test('loading callbacks cannot run preparation for an already superseded session intent', async () => {
  const { app } = fixture(),
    checkpoint = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>();
  Object.assign(app.bridge, {
    loadGame: () => checkpoint.promise,
    saveGame: async () => {},
  });
  let latest: Promise<boolean> | undefined,
    preparations = 0;
  app.hooks.loading = (active) => {
    if (active) {
      latest = app.load();
      void latest.catch(() => {});
    }
  };
  await assert.rejects(
    app.replaceSession(app.scenes, {
      kind: 'new',
      prepare: () => {
        preparations++;
      },
    }),
    /superseded/,
  );
  assert.equal(preparations, 0, 'Cancelled preparation may have caller-owned side effects');
  assert.equal(app.busy, true);
  checkpoint.resolve({ status: 'empty' });
  assert.equal(await latest, false);
  assert.equal(app.busy, false);
  app.dispose();
});

test('session replacement preserves independent pending asset acquisitions', async () => {
  const { app, lease } = fixture(),
    waiting = Promise.withResolvers<PackLease>();
  let assetSignal: AbortSignal | undefined;
  app.runtime = runtime((_id, signal) => {
    assetSignal = signal;
    return waiting.promise;
  });
  const retaining = app.retainAsset('gallery');
  await app.reset();
  assert.equal(assetSignal?.aborted, false, 'Room changes must not abort the asset lifetime');
  waiting.resolve(lease);
  await retaining;
  assert.equal(app.packs.get('gallery'), lease);
  app.dispose();
  assert.equal(assetSignal?.aborted, true);
});

test('session asset requests share one lease; disposal and failed warming release acquisitions', async () => {
  const f = fixture(),
    pending = Promise.withResolvers<PackLease>();
  let loads = 0;
  f.app.runtime = runtime(() => {
    loads++;
    return pending.promise;
  });
  const first = f.app.retainAsset('gallery'),
    second = f.app.retainAsset('gallery');
  pending.resolve(f.lease);
  await Promise.all([first, second]);
  assert.equal(loads, 1);
  assert.equal(f.warmed, 1);
  assert.equal(f.app.packs.get('gallery'), f.lease);

  f.app.dispose();
  f.app.dispose();
  assert.equal(f.released, 1);
  await assert.rejects(f.app.retainAsset('gallery'), /disposed/);
  const late = fixture(),
    wait = Promise.withResolvers<PackLease>();
  late.app.runtime = runtime(() => wait.promise);
  const loading = late.app.retainAsset('gallery');
  late.app.dispose();
  wait.resolve(late.lease);
  await assert.rejects(loading, /disposed/);
  assert.equal(late.released, 1);
  assert.equal(late.warmed, 0);
  assert.equal(late.app.packs.size, 0);
  const failure = fixture();
  failure.app.runtime = runtime(async () => failure.lease);
  failure.app.presentation.warmPack = () => {
    throw new Error('GPU unavailable');
  };
  await assert.rejects(failure.app.retainAsset('gallery'), /GPU unavailable/);
  assert.equal(failure.released, 1);
  failure.app.presentation.warmPack = () => {};
  await failure.app.retainAsset('gallery');
  assert.equal(failure.app.packs.size, 1);
  failure.app.dispose();
});
test('failed room preparation keeps the current session and packs; retry replaces and disposes each batch once', async () => {
  const { app } = fixture({
      ...sceneFixture(content),
      area: (id) => ({ area: content.area(id), assets: [id] }),
    }),
    releases: string[] = [],
    initial = app.sim.area,
    destination = 'upper-landing',
    snapshot = new GameSession(content, 142, destination).captureSave();
  app.input = {
    clear: () => {},
    resetAim: () => {},
    dispose: () => {},
  } as unknown as typeof app.input;
  app.runtime = runtime(
    async (id) => ({ release: () => releases.push(id) }) as unknown as PackLease,
  );
  await app.reset();
  const previous = app.sim,
    pack = app.packs.get(initial);
  app.presentation.prepareAssets = async () => {
    throw new Error('companions unavailable');
  };
  await assert.rejects(app.restore(snapshot), /companions unavailable/);
  assert.equal(app.sim, previous);
  assert.equal(app.roomReady, true, 'Failure before commit preserves the accepted room');
  assert.equal(app.packs.get(initial), pack);
  assert.equal(app.packs.has(destination), false);
  assert.equal(app.busy, false);
  assert.deepEqual(releases, [destination]);
  app.presentation.prepareAssets = async () => {};
  await app.restore(snapshot);
  assert.equal(app.sim.area, destination);
  assert.equal(app.packs.has(initial), false);
  assert.equal(app.packs.has(destination), true);
  assert.deepEqual(releases, [destination, initial]);
  app.dispose();
  app.dispose();
  assert.deepEqual(releases, [destination, initial, destination]);
});
test('shutdown settles boot before a stalled catalog returns and disposes the late runtime', async (t) => {
  const { app } = fixture(),
    opening = Promise.withResolvers<AssetRuntime>(),
    started = Promise.withResolvers<void>();
  let closed = 0,
    settled = false,
    acquisitions = 0;
  t.mock.method(AssetRuntime, 'open', () => {
    started.resolve();
    return opening.promise;
  });
  const late = runtime(async () => {
    acquisitions++;
    assert.fail('acquisition after shutdown');
  });
  t.mock.method(late, 'dispose', () => closed++);
  const boot = app.boot();
  const result = boot.catch((error: unknown) => {
    settled = true;
    return error;
  });
  try {
    await started.promise;
    app.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, true, 'Shutdown must not wait for catalog transport');
    assert.match(String(await result), /disposed/);
  } finally {
    opening.resolve(late);
    await result;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(closed, 1, 'The acquisition still owns and closes its late result');
  assert.equal(acquisitions, 0);
  assert.equal(app.ready, false);
  assert.equal(app.canvas.dataset.ready, undefined);
});

test('shutdown settles boot while renderer warmup is stalled and discards late completion', async (t) => {
  const warming = Promise.withResolvers<void>(),
    started = Promise.withResolvers<void>();
  let settled = false,
    closed = 0,
    frames = 0;
  mockGlobals(t, {
    document: Object.assign(new EventTarget(), { hasFocus: () => true, hidden: false }),
  });
  t.mock.method(AssetRuntime, 'open', async () => runtime(async () => assert.fail('no packs')));
  const app = new Application(
    Object.assign(new EventTarget(), { dataset: {} }) as HTMLCanvasElement,
    {},
    { loadSettings: async () => ({ status: 'empty' }) } as Bridge,
    sceneFixture(content),
    () =>
      presentationFixture({
        warm: () => {
          started.resolve();
          return warming.promise;
        },
        update: () => frames++,
        dispose: () => closed++,
      }),
    { status() {}, pause() {}, frame() {} },
  );
  const result = app.boot().catch((error: unknown) => {
    settled = true;
    return error;
  });
  try {
    await started.promise;
    app.dispose();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, true, 'Shutdown must not wait for GPU work');
    assert.match(String(await result), /disposed/);
  } finally {
    warming.resolve();
    await result;
    await new Promise<void>((resolve) => setImmediate(resolve));
    app.dispose();
  }
  assert.equal(closed, 1);
  assert.equal(frames, 0);
  assert.equal(app.ready, false);
});

test('a renderer returned by a factory that shuts down the application is disposed before input mounts', async (t) => {
  let closed = 0,
    mounts = 0;
  t.mock.method(AssetRuntime, 'open', async () => runtime(async () => assert.fail('no packs')));
  const app = new Application(
    {
      dataset: {},
      addEventListener: () => mounts++,
    } as unknown as HTMLCanvasElement,
    {},
    { loadSettings: async () => ({ status: 'empty' }) } as Bridge,
    sceneFixture(content),
    () => {
      app.dispose();
      return presentationFixture({ dispose: () => closed++ });
    },
    { status() {}, pause() {}, frame() {} },
  );
  await assert.rejects(app.boot(), /disposed/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  assert.equal(mounts, 0);
  assert.equal(app.ready, false);
  app.dispose();
  assert.equal(closed, 1);
});

test('checkpoint startup selects one room and shares boot while all companions gate the first frame', async (t) => {
  mockGlobals(t, {
    document: Object.assign(new EventTarget(), { hasFocus: () => true, hidden: false }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  // oxlint-disable-next-line typescript/unbound-method -- Saved for restoration, never invoked unbound.
  const open = AssetRuntime.open;
  t.after(() => {
    AssetRuntime.open = open;
  });
  for (const mode of ['saved', 'empty', 'invalid', 'error', 'new'] as const) {
    const save = new GameSession(content, 99, 'upper-landing').captureSave();
    const areas: string[] = [],
      messages: string[] = [],
      calls: string[] = [];
    const flow = Promise.withResolvers<void>(),
      normals = Promise.withResolvers<void>();
    const scenes = {
      ...sceneFixture(content),
      area: (id: string) => {
        areas.push(id);
        return { area: content.area(id), assets: [] };
      },
    };
    const bridge: Bridge = {
      automatedRun: true,
      loadSettings: async () => ({ status: 'empty' }),
      saveSettings: async () => {},
      saveGame: async () => {},
      loadGame: async () => {
        calls.push('checkpoint');
        if (mode === 'error') throw new Error('storage unavailable');
        if (mode === 'invalid') return { status: 'ok', data: { ...save, area: 'missing' } };
        return mode === 'empty' ? { status: 'empty' } : { status: 'ok', data: save };
      },
    };
    AssetRuntime.open = async () => runtime(async () => assert.fail('no packs needed'));
    const canvas = Object.assign(new EventTarget(), {
      dataset: {},
    }) as unknown as HTMLCanvasElement;
    const app = new Application(
      canvas,
      {},
      bridge,
      scenes,
      () =>
        presentationFixture({
          loadAnimationFlow: () => {
            calls.push('flow');
            return flow.promise;
          },
          prepareAssets: () => {
            calls.push('normals');
            return normals.promise;
          },
          warm: async () => {
            calls.push('warm');
          },
          update: () => {
            calls.push('frame');
          },
        }),
      { status: (message) => messages.push(message), frame: () => {}, pause: () => {} },
      { startup: mode === 'new' ? 'new' : 'checkpoint' },
    );
    t.after(() => app.dispose());
    const boot = app.boot();
    assert.equal(app.boot(), boot);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(areas, [
      mode === 'saved' ? 'upper-landing' : 'court',
      mode === 'saved' ? 'upper-landing' : 'court',
    ]);
    assert.equal(calls.includes('flow') && calls.includes('normals'), true);
    flow.resolve();
    await Promise.resolve();
    assert.equal(app.ready, false);
    assert.equal(calls.includes('warm'), false);
    await assert.rejects(app.load(), /startup/);
    normals.resolve();
    await boot;
    assert.equal(app.sim.area, mode === 'saved' ? 'upper-landing' : 'court');
    assert.equal(calls.filter((c) => c === 'warm').length, 1);
    assert.ok(calls.indexOf('frame') > calls.indexOf('warm'));
    assert.equal(calls.filter((c) => c === 'checkpoint').length, mode === 'new' ? 0 : 1);
    assert.equal(
      messages.some((message) => message.startsWith('Checkpoint unavailable:')),
      mode === 'error' || mode === 'invalid',
    );
    app.dispose();
  }
});

test('simulation enablement isolates lab policy, keeps rendering, and clears catch-up time', async () => {
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

test('overlapping loading scopes reveal a rendered destination only after every request settles', async () => {
  const { app } = fixture(),
    first = Promise.withResolvers<void>(),
    second = Promise.withResolvers<void>();
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
  const late = Promise.withResolvers<void>();
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

test('checkpoint reading freezes gameplay and recovers loading state for empty saves and storage failures', async () => {
  const { app } = fixture(),
    waiting = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>();
  const states: boolean[] = [];
  app.hooks.loading = (active) => states.push(active);
  Object.assign(app.bridge, {
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
  Object.assign(app.bridge, {
    loadGame: async () => {
      throw new Error('storage unavailable');
    },
    saveGame: async () => {},
  });
  await assert.rejects(app.load(), /storage unavailable/);
  assert.deepEqual(states, [true, false, true, false]);
});

test('startup settles the initial asset batch and releases successful peers when any pack fails or boot is disposed', async () => {
  for (const cancelled of [false, true]) {
    const waiting = Promise.withResolvers<PackLease>(),
      requested: string[] = [];
    let released = 0;
    // oxlint-disable-next-line typescript/unbound-method -- Saved for restoration, never invoked unbound.
    const open = AssetRuntime.open;
    const app = new Application(
      { dataset: {} } as unknown as HTMLCanvasElement,
      { first: 'first', second: 'second' },
      {} as Bridge,
      { ...sceneFixture(content), initialAssets: ['first', 'second'] },
      () => presentationFixture(),
      { status: () => {}, pause: () => {}, frame: () => {} },
    );
    AssetRuntime.open = async () =>
      runtime(async (id: string) => {
        requested.push(id);
        if (id === 'first') return waiting.promise;
        if (!cancelled) throw new Error('missing pack');
        return { release: () => released++ } as unknown as PackLease;
      });
    using _scopeExit3 = onExit(() => {
      app.dispose();
      AssetRuntime.open = open;
    });
    const boot = app.boot();
    const rejected = assert.rejects(boot, cancelled ? /disposed/ : /missing pack/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(requested, ['first', 'second']);
    if (cancelled) app.dispose();
    waiting.resolve({ release: () => released++ } as unknown as PackLease);
    await rejected;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(released, cancelled ? 2 : 1);
    assert.equal(app.packs.size, 0);
    assert.equal(app.ready, false);
  }
});

test('room rebuild failure retains both generations until a successful rebuild or disposal', async () => {
  for (const retry of [false, true]) {
    const { app } = fixture({
        ...sceneFixture(content),
        area: (id) => ({ area: content.area(id), assets: [id] }),
      }),
      loaded: PackLease[] = [],
      released: PackLease[] = [],
      snapshot = new GameSession(content, 142, 'upper-landing').captureSave();
    app.runtime = runtime(async () => {
      const pack = { release: () => released.push(pack) } as unknown as PackLease;
      loaded.push(pack);
      return pack;
    });
    await app.reset();
    app.presentation.resetRoom = () => {
      assert.equal(app.packs.get(snapshot.area), loaded[1]);
      throw new Error('room construction failed');
    };
    await assert.rejects(app.restore(snapshot), /room construction failed/);
    assert.equal(app.sim.area, snapshot.area);
    assert.deepEqual(released, [], 'A partial renderer may reference either generation');
    assert.equal(app.packs.get(snapshot.area), loaded[1]);
    if (retry) {
      app.presentation.resetRoom = () => {};
      await app.restore(snapshot);
      assert.deepEqual(released, loaded.slice(0, 2));
      assert.equal(app.packs.get(snapshot.area), loaded[2]);
    }
    app.dispose();
    app.dispose();
    assert.deepEqual(released, loaded, 'Every consumed batch is released exactly once');
  }
});

test('feedback failure after a transition cannot cancel its committed destination or autosave', async () => {
  const { app } = fixture();
  const statuses: string[] = [],
    saves: string[] = [];
  app.hooks.status = (message) => statuses.push(message);
  Object.assign(app.bridge, {
    loadGame: async () => ({ status: 'empty' }),
    saveGame: async (save: Parameters<Bridge['saveGame']>[0]) => {
      saves.push(save.area);
    },
  });
  editFixture(app, (sim) => {
    for (const enemy of sim.enemies) enemy.health = 0;
  });
  editFixture(app, (sim) => {
    sim.cleared = true;
  });
  const exit = app.sim.areaDefinition.exits[0]!;
  app.events.subscribe((event) => {
    if (event.kind === 'area-transition') throw new Error('broken transition feedback');
  });
  const received: string[] = [];
  app.events.subscribe((event) => received.push(event.kind));
  await app.transition(exit.id);
  assert.equal(app.sim.area, exit.destination);
  assert.equal(app.paused, false);
  assert.equal(app.session.loading, false);
  assert.equal(app.busy, false);
  assert.deepEqual(saves, [exit.destination]);
  assert.deepEqual(received, ['transition-start', 'area-transition']);
  assert.equal(statuses.length, 1);
  assert.match(statuses[0]!, /broken transition feedback/);
  app.dispose();
});

test('failed room acceptance blocks rendering, gameplay and saves until recovery', async () => {
  for (const failure of ['rebuild', 'companions'] as const) {
    const { app } = fixture(),
      snapshot = new GameSession(content, 142, 'upper-landing').captureSave();
    Object.assign(app.bridge, { automatedRun: true });
    app.command = () => ({ move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } });
    app.ready = true;
    let saves = 0,
      renders = 0,
      preparations = 0;
    Object.assign(app.bridge, {
      loadGame: async () => ({ status: 'empty' }),
      saveGame: async () => {
        saves++;
      },
    });
    app.presentation.update = () => {
      renders++;
    };
    const feedback = Promise.withResolvers<void>();
    let lifetime: AbortSignal | undefined;
    app.events.subscribe((_event, signal) => {
      lifetime = signal;
      return feedback.promise;
    });
    await app.reset();
    renders = 0;
    const originalLifetime = lifetime!;
    app.presentation.resetRoom = () => {
      assert.equal(
        originalLifetime.aborted,
        true,
        'Commit must close old feedback before rebuilding',
      );
      if (failure === 'rebuild') throw new Error('rebuild failed');
    };
    app.presentation.prepareAssets = async () => {
      if (++preparations === 2 && failure === 'companions') throw new Error('companions failed');
    };
    await assert.rejects(app.restore(snapshot), /failed/);
    assert.equal(app.sim.area, snapshot.area);
    assert.equal(app.busy, false);
    assert.equal(app.roomReady, false);
    assert.equal(app.paused, true);
    app.pause(false);
    assert.equal(app.paused, true, 'Resume cannot bypass room recovery');
    const tick = app.sim.tick;
    const frame = Reflect.get(app, 'loop') as (now: number) => void;
    frame(performance.now() + 1000);
    assert.equal(app.sim.tick, tick);
    assert.equal(renders, 0, 'A partial renderer must not receive simulation updates');
    await assert.rejects(app.save(), /room.*ready/i);
    app.autosave();
    assert.equal(saves, 0);
    assert.equal(await app.load(), false, 'An empty checkpoint cannot recover the renderer');
    assert.equal(app.roomReady, false);
    app.presentation.resetRoom = () => {};
    app.presentation.prepareAssets = async () => {};
    await app.reset();
    assert.equal(app.roomReady, true);
    assert.equal(app.paused, false);
    assert.equal(renders, 1);
    frame(performance.now() + 20);
    assert.ok(app.sim.tick > tick);
    app.bridge.saveSettings = async () => {};
    await app.save();
    assert.equal(saves, 1);
    feedback.resolve();
    app.dispose();
  }
});

test('superseding a committed room cannot accept it through an obsolete completion or an empty load', async () => {
  const { app } = fixture(),
    preparing = Promise.withResolvers<void>(),
    committed = Promise.withResolvers<void>();
  app.readOnly = true;
  Object.assign(app.bridge, {
    loadGame: async () => ({ status: 'empty' }),
    saveGame: async () => assert.fail('read-only'),
  });
  let preparations = 0;
  let preparationSignal: AbortSignal | undefined;
  app.presentation.prepareAssets = async (_ids, signal) => {
    if (++preparations === 2) {
      preparationSignal = signal;
      committed.resolve();
      await preparing.promise;
    }
  };
  const resetting = app.reset();
  const rejected = assert.rejects(resetting, /superseded/);
  await committed.promise;
  assert.equal(app.roomReady, false);
  assert.equal(await app.load(), false);
  assert.equal(app.roomReady, false);
  assert.equal(app.paused, true, 'The latest operation must leave recovery accessible');
  await rejected;
  assert.equal(preparationSignal?.aborted, true, 'Companion work receives room cancellation');
  assert.equal(app.roomReady, false, 'Obsolete preparation cannot reopen the simulation');
  assert.equal(app.busy, false);
  await app.reset();
  assert.equal(app.roomReady, true);
  assert.equal(app.paused, false);
  const generation = app.session.generation;
  preparing.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(app.session.generation, generation);
  assert.equal(app.roomReady, true, 'Late obsolete completion cannot revoke the recovered room');
  app.dispose();
});

test('frame reset requests wait for room acceptance before feedback and saving, and failures block play', async () => {
  for (const trigger of ['death', 'command', 'hook'] as const) {
    for (const failure of ['none', 'rebuild', 'companions'] as const) {
      const { app } = fixture(),
        waiting = Promise.withResolvers<void>(),
        feedback: string[] = [],
        saved: number[] = [];
      Object.assign(app.bridge, { automatedRun: true });
      app.ready = true;
      app.command = () =>
        trigger === 'command' ? { reset: 'manual' } : { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } };
      Object.assign(app.bridge, {
        loadGame: async () => ({ status: 'empty' }),
        saveGame: async () => {
          saved.push(app.sim.generation);
        },
      });
      app.events.subscribe((event) => feedback.push(event.kind));
      let preparations = 0,
        rebuilds = 0,
        renders = 0;
      app.presentation.prepareAssets = async () => {
        if (++preparations === 1) await waiting.promise;
        else if (failure === 'companions') throw new Error('companions failed');
      };
      app.presentation.resetRoom = () => {
        rebuilds++;
        if (failure === 'rebuild') throw new Error('rebuild failed');
      };
      app.presentation.update = () => {
        renders++;
      };
      let recovery!: Promise<unknown>;
      app.safe = (work) => {
        recovery = work();
        void recovery.catch(() => {});
      };
      const previous = app.sim;
      if (trigger === 'death') {
        editFixture(app, (sim) => {
          sim.hero.health = 0;
          sim.start(sim.hero, 'death');
          sim.hero.age = tuning.deathHoldTicks;
        });
      } else if (trigger === 'hook') app.beforeStep = () => app.safe(() => app.reset());
      const frame = Reflect.get(app, 'loop') as (now: number) => void;
      frame(performance.now() + 20);
      assert.ok(recovery, 'The frame must dispatch the reset request');
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(app.busy, true);
      assert.equal(app.sim, previous, 'Acquisition and preparation precede simulation replacement');
      assert.deepEqual(saved, []);
      assert.deepEqual(feedback, []);
      if (trigger !== 'death')
        assert.equal(previous.tick, 0, 'Reset admission stops the current step');
      const tick = previous.tick;
      frame(performance.now() + 1000);
      assert.equal(previous.tick, tick, 'Pending recovery freezes further simulation steps');
      waiting.resolve();
      if (failure === 'none') {
        await recovery;
        assert.equal(app.roomReady, true);
        assert.equal(app.sim.hero.health, 100);
        assert.equal(app.session.resetCount, 1);
        assert.equal(app.presentation.generation, app.sim.generation);
        assert.equal(rebuilds, 1);
        assert.deepEqual(feedback, ['room-reset']);
        assert.deepEqual(saved, trigger === 'death' ? [app.sim.generation] : []);
      } else {
        await assert.rejects(recovery, /failed/);
        assert.equal(app.roomReady, false);
        assert.equal(app.paused, true);
        assert.deepEqual(feedback, [], 'Unaccepted rooms cannot publish reset success');
        assert.deepEqual(saved, [], 'A failed rebuild must not overwrite the checkpoint');
        const acceptedRenders = renders,
          failedTick = app.sim.tick;
        frame(performance.now() + 2000);
        assert.equal(app.sim.tick, failedTick);
        assert.equal(renders, acceptedRenders, 'A partial room cannot receive render updates');
        app.presentation.prepareAssets = async () => {};
        app.presentation.resetRoom = () => {};
        await app.reset();
        assert.equal(app.roomReady, true);
      }
      app.dispose();
    }
  }
});

test('superseding campfire travel cancels its plan immediately and releases the late destination', async () => {
  const definitions = structuredClone(contentDefinitions);
  for (const area of definitions.areas) {
    const entry = area.entries[0]!;
    area.campfires = [
      { id: 'fire', name: 'Fire', x: entry.x, z: entry.z, safeRadius: 1, discovered: true },
    ];
    area.entries = [...area.entries, { ...entry, id: 'fire-fire' }];
  }
  const registry = new ContentRegistry(definitions);
  const { app } = fixture(
    {
      ...sceneFixture(registry),
      area: (id) => ({ area: registry.area(id), assets: [id] }),
    },
    { automatedRun: true } as Bridge,
  );
  const waiting = Promise.withResolvers<PackLease>();
  const checkpoint = Promise.withResolvers<Awaited<ReturnType<Bridge['loadGame']>>>();
  let released = 0;
  app.runtime = runtime(() => waiting.promise);
  Object.assign(app.bridge, {
    loadGame: () => checkpoint.promise,
    saveGame: async () => {},
  });
  const original = app.sim;
  const travel = app.travel('upper-landing/fire');
  const rejected = assert.rejects(travel, /superseded/);
  assert.equal(app.session.loading, true);
  const latest = app.load();
  assert.equal(app.session.loading, false);
  waiting.resolve({ release: () => released++ } as unknown as PackLease);
  await rejected;
  assert.equal(app.sim, original);
  assert.equal(released, 1);
  assert.equal(app.busy, true);
  checkpoint.resolve({ status: 'empty' });
  assert.equal(await latest, false);
  assert.equal(app.busy, false);
  app.dispose();
});

test('shutdown drains all owners after UI, renderer and lease failures and cannot run twice', async () => {
  const { app } = fixture();
  const calls: string[] = [];
  const failure = (name: string) => () => {
    calls.push(name);
    throw new Error(name);
  };
  app.runtime = runtime(async (id) => ({
    manifest: manifestFixture(id),
    textures: new Map(),
    release: failure(id),
  }));
  await app.retainAsset('retained');
  await app.previewAsset('preview', () => {});
  app.hooks.loading = failure('loading');
  app.input.dispose = () => {
    calls.push('input');
  };
  app.presentation.dispose = failure('presentation');
  app.runtime.dispose = () => {
    calls.push('runtime');
  };
  let aborted = false;
  app.events.subscribe((_event, signal) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
  });
  app.publish([
    {
      kind: 'room-clear',
      key: 'close',
      tick: 1,
      generation: app.session.generation,
      actor: 'player',
      action: 0,
      area: app.sim.area,
      position: [0, 0, 0],
      direction: 0,
    },
  ]);
  assert.throws(() => app.dispose(), AggregateError);
  assert.deepEqual(calls, ['loading', 'input', 'presentation', 'preview', 'retained', 'runtime']);
  assert.equal(aborted, true);
  assert.equal(app.packs.size, 0);
  assert.equal(app.ready, false);
  assert.equal(app.roomReady, false);
  assert.throws(() => app.changeInventory({ kind: 'salvage' }), /loading/);
  app.dispose();
  assert.equal(calls.length, 6);
});

test('failed startup retains its original cause while draining a failed cleanup', async () => {
  const { app } = fixture();
  const primary = new Error('catalog unavailable'),
    secondary = new Error('loading UI failed');
  let closed = 0;
  // oxlint-disable-next-line typescript/unbound-method -- Saved for restoration, never invoked unbound.
  const open = AssetRuntime.open;
  AssetRuntime.open = async () => {
    throw primary;
  };
  app.hooks.loading = (active) => {
    if (!active) throw secondary;
  };
  app.runtime.dispose = () => {
    closed++;
  };
  using _scopeExit2 = onExit(() => {
    AssetRuntime.open = open;
  });
  await assert.rejects(app.boot(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    const operation = error.cause;
    assert.ok(operation instanceof AggregateError);
    assert.equal(operation.cause, primary);
    assert.deepEqual(operation.errors, [primary, secondary]);
    assert.equal(error.errors[1], secondary);
    return true;
  });
  assert.equal(closed, 1);
  app.dispose();
  assert.equal(closed, 1);
});

test('health pickup commits an autosaved checkpoint including its consumed identity', async () => {
  const definitions = structuredClone(contentDefinitions),
    area = definitions.areas[0]!;
  area.pickups = [
    { id: 'healing', object: 'healing', kind: 'health', x: 0, z: 6.65, radius: 1, amount: 20 },
  ];
  const saves: ReturnType<GameSession['captureSave']>[] = [],
    { app } = fixture(sceneFixture(new ContentRegistry(definitions)), {
      automatedRun: true,
      saveGame: async (save) => {
        saves.push(save);
      },
    } as Bridge);
  editFixture(app, (sim) => {
    sim.hero.health = 50;
  });
  app.command = () => ({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } });
  app.pause(false);
  const frame = Reflect.get(app, 'loop') as (now: number) => void;
  frame(performance.now() + 20);
  await Promise.resolve();
  assert.equal(app.sim.hero.health, 70);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0]!.areas.court!.collectedPickups, ['healing']);
  assert.equal(saves[0]!.player.health, 70);
  app.dispose();
});

test('manual adventure reset saves the restored player and enemy state', async () => {
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.entries = [
    ...definitions.areas[0]!.entries,
    { id: 'fire-home', x: 0, z: 6.65 },
  ];
  definitions.areas[0]!.campfires = [
    { id: 'home', name: 'Home', x: 0, z: 6.65, safeRadius: 1, discovered: true },
  ];
  const saves: ReturnType<GameSession['captureSave']>[] = [],
    { app } = fixture(sceneFixture(new ContentRegistry(definitions)), {
      saveGame: async (save) => {
        saves.push(save);
      },
    } as Bridge);
  editFixture(app, (sim) => {
    sim.hero.health = 25;
    sim.enemies[0]!.health = 1;
  });
  await app.reset('manual');
  assert.equal(saves.length, 1);
  assert.equal(saves[0]!.player.health, 100);
  assert.equal(saves[0]!.areas.court!.actors['warden-1']!.health, 50);
  app.dispose();
});

test('rejected room preparation preserves the accepted room and starts no renderer work', async () => {
  const { app } = fixture();
  const sim = app.sim,
    save = app.session.captureSave();
  let preparations = 0;
  app.presentation.prepareAssets = async () => {
    preparations++;
  };
  await assert.rejects(app.rest('court/missing'), /campfire/i);
  assert.equal(app.roomReady, true);
  assert.equal(app.sim, sim);
  assert.deepEqual(app.session.captureSave(), save);
  assert.equal(preparations, 0);
  assert.equal(app.busy, false);
  app.dispose();
});

test('application inspection borrows live state without simulation command capabilities', async () => {
  const { app } = fixture();
  const view = app.sim;
  for (const command of ['step', 'populate', 'damage', 'start', 'collectDrop', 'openContainer'])
    assert.equal(command in view, false, command);
  assert.equal(Object.isFrozen(view), true);
  // oxlint-disable-next-line no-constant-condition -- Compile-only read boundary checks.
  if (false) {
    // @ts-expect-error Ordinary hosts cannot advance gameplay outside Application.
    app.sim.step();
    // @ts-expect-error Inspection cannot mutate actors.
    app.sim.hero.health = 0;
    // @ts-expect-error Inspection cannot replace actors or mutate collections.
    app.sim.actors.push(app.sim.hero);
    // @ts-expect-error Developer edits must complete synchronously.
    app.editPreview(async () => {});
  }
  app.command = (sim) => {
    sim.hero.health = 45;
    return { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } };
  };
  Object.assign(app.bridge, { automatedRun: true });
  app.pause(false);
  const frame = Reflect.get(app, 'loop') as (now: number) => void;
  frame(performance.now() + 20);
  assert.equal(app.sim, view);
  assert.equal(view.hero.health, 45);
  assert.ok(view.tick > 0);
  await app.reset();
  assert.notEqual(app.sim, view);
  assert.equal(app.sim.hero.health, 100);
  assert.equal(view.hero.health, 45, 'Retained inspection still refers to its original room');
  app.dispose();
});

test('preview edits require an accepted developer room across loading, failure and disposal', async () => {
  const { app } = fixture();
  let edits = 0;
  const edit = (sim: Simulation): undefined => {
    edits++;
    sim.hero.health = 33;
  };
  assert.throws(() => app.editPreview(edit), /read-only/);
  app.readOnly = true;
  app.editPreview(edit);
  assert.equal(app.sim.hero.health, 33);
  const startup = Promise.withResolvers<void>();
  const loading = app.withLoading(() => startup.promise);
  assert.throws(() => app.editPreview(edit), /loading/);
  startup.resolve();
  await loading;
  const waiting = Promise.withResolvers<void>();
  app.presentation.prepareAssets = () => waiting.promise;
  const replacing = app.reset();
  assert.throws(() => app.editPreview(edit), /loading/);
  waiting.resolve();
  await replacing;
  app.presentation.resetRoom = () => {
    throw new Error('rebuild failed');
  };
  await assert.rejects(app.reset(), /rebuild failed/);
  assert.throws(() => app.editPreview(edit), /loading/);
  app.presentation.resetRoom = () => {};
  await app.reset();
  app.editPreview(edit);
  assert.equal(app.sim.hero.health, 33);
  app.dispose();
  assert.throws(() => app.editPreview(edit), /disposed/);
  assert.equal(edits, 2, 'Rejected edits must never run their callbacks');
});

test('frame admission is revoked by hooks and disposal before gameplay or further callbacks', () => {
  for (const [boundary, steps] of [
    ['step', 0],
    ['resume', 0],
    ['command', 0],
    ['feedback', 1],
    ['pause-feedback', 1],
    ['render', 6],
    ['frame', 6],
  ] as const) {
    const { app } = fixture();
    Object.assign(app.bridge, { automatedRun: true });
    let renders = 0,
      frames = 0,
      after = 0,
      renderMs = -1,
      renderAlpha = -1;
    app.hooks.frame = () => {
      frames++;
      if (boundary === 'frame') app.dispose();
    };
    app.afterFrame = () => {
      after++;
    };
    app.presentation.update = (_sim, alpha, ms) => {
      renders++;
      renderAlpha = alpha;
      renderMs = ms;
      if (boundary === 'render') app.dispose();
    };
    app.command = () => {
      if (boundary === 'command') app.setSimulationEnabled(false);
      return { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 }, actions: ['dodge'] };
    };
    if (boundary === 'step') app.beforeStep = () => app.pause(true);
    if (boundary === 'resume')
      app.beforeStep = () => {
        app.pause(true);
        app.pause(false);
      };
    if (boundary === 'feedback') app.events.subscribe(() => app.dispose());
    if (boundary === 'pause-feedback') app.events.subscribe(() => app.pause(true));
    editFixture(app, (sim) => {
      sim.enemies[0]!.burn = { remaining: 180, nextTick: 60 };
      return undefined;
    });
    const tick = app.sim.tick;
    const frame = Reflect.get(app, 'loop') as (now: number) => void;
    frame(performance.now() + 100);
    assert.equal(app.sim.tick, tick + steps, boundary);
    assert.equal(
      app.sim.enemies[0]!.burn?.nextTick,
      60 - steps,
      'Burn advances only admitted simulation ticks',
    );
    assert.equal(renders, boundary === 'feedback' ? 0 : 1, boundary);
    assert.equal(frames, boundary === 'feedback' || boundary === 'render' ? 0 : 1, boundary);
    assert.equal(after, boundary === 'frame' ? 0 : frames, boundary);
    if (boundary === 'step' || boundary === 'resume' || boundary === 'pause-feedback') {
      assert.equal(renderMs, 0, boundary);
      assert.equal(
        renderAlpha,
        1,
        'Revoked frames show the committed position without interpolation',
      );
    }
    app.dispose();
  }
});

test('startup owns one prepared renderer and revokes it on failure or disposal', async (t) => {
  // oxlint-disable-next-line typescript/unbound-method -- Saved for restoration, never invoked unbound.
  const open = AssetRuntime.open;
  t.after(() => {
    AssetRuntime.open = open;
  });
  for (const failure of ['catalog', 'disposed'] as const) {
    const { app } = fixture();
    let preparations = 0,
      closed = 0,
      factories = 0;
    const upload = () => {};
    app.createPresentation.prepare = () => {
      preparations++;
      return {
        prepareTexture: upload,
        create: () => {
          factories++;
          return presentationFixture();
        },
        dispose: () => closed++,
      };
    };
    const opening = Promise.withResolvers<AssetRuntime>();
    const started = Promise.withResolvers<void>();
    AssetRuntime.open = (...args) => {
      assert.equal(args[4], upload);
      started.resolve();
      return opening.promise;
    };
    const boot = app.boot();
    assert.equal(app.boot(), boot);
    const rejected = assert.rejects(boot, /failed|disposed/);
    await started.promise;
    if (failure === 'catalog') opening.reject(new Error('catalog failed'));
    else {
      app.dispose();
      opening.resolve(runtime(async () => assert.fail('acquisition after disposal')));
    }
    await rejected;
    assert.equal(preparations, 1);
    assert.equal(closed, 1);
    assert.equal(factories, 0);
    app.dispose();
    assert.equal(closed, 1);
  }
});

test('renderer preparation returned after reentrant shutdown is consumed before acquisition', async () => {
  const { app } = fixture();
  let closed = 0;
  app.createPresentation.prepare = () => {
    app.dispose();
    return {
      prepareTexture: () => assert.fail('upload after shutdown'),
      create: () => assert.fail('construction after shutdown'),
      dispose: () => closed++,
    };
  };
  await assert.rejects(app.boot(), /disposed/);
  assert.equal(closed, 1);
  app.dispose();
  assert.equal(closed, 1);
});

test('startup transfers the prepared renderer factory and revokes uploads before presentation shutdown', async (t) => {
  mockGlobals(t, {
    document: Object.assign(new EventTarget(), { hasFocus: () => true, hidden: false }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  });
  // oxlint-disable-next-line typescript/unbound-method -- Saved for restoration, never invoked unbound.
  const open = AssetRuntime.open;
  t.after(() => {
    AssetRuntime.open = open;
  });
  const calls: string[] = [];
  const canvas = Object.assign(new EventTarget(), { dataset: {} }) as unknown as HTMLCanvasElement;
  const bridge = {
    automatedRun: true,
    loadSettings: async () => ({ status: 'empty' }),
    saveSettings: async () => {},
    loadGame: async () => ({ status: 'empty' }),
    saveGame: async () => {},
  } as Bridge;
  let closed = false;
  const upload = () => {
    if (closed) throw new Error('revoked');
    calls.push('upload');
  };
  const factory = Object.assign(() => assert.fail('unprepared factory'), {
    prepare: () => {
      calls.push('prepare');
      return {
        prepareTexture: upload,
        create: () => {
          calls.push('create');
          return presentationFixture({
            update: () => calls.push('frame'),
            dispose: () => {
              assert.equal(closed, true);
              calls.push('presentation-dispose');
            },
          });
        },
        dispose: () => {
          closed = true;
          calls.push('graphics-dispose');
        },
      };
    },
  });
  AssetRuntime.open = async (...args) => {
    calls.push('open');
    assert.equal(args[4], upload);
    upload();
    return runtime(async () => assert.fail('no assets required'));
  };
  const app = new Application(canvas, {}, bridge, sceneFixture(content), factory, {
    status: () => {},
    pause: () => {},
    frame: () => {},
  });
  t.after(() => app.dispose());
  const boot = app.boot();
  assert.equal(app.boot(), boot);
  await boot;
  assert.deepEqual(calls.slice(0, 5), ['prepare', 'open', 'upload', 'create', 'frame']);
  assert.equal(calls.filter((call) => call === 'create').length, 1);
  app.dispose();
  assert.deepEqual(calls.slice(-2), ['graphics-dispose', 'presentation-dispose']);
  assert.throws(upload, /revoked/);
});

test('forge purchase saves one atomic candidate, blocks overlapping commands and spends nothing on failure', async () => {
  const session = forgeFixture();
  supplyForge(session);
  const writes: GameSave[] = [];
  let resolveWrite!: () => void;
  let rejectWrite!: (error: Error) => void;
  const { app } = fixture(sceneFixture(session.registry), {
    saveGame: (save) => {
      writes.push(structuredClone(save));
      return new Promise<void>((resolve, reject) => {
        resolveWrite = resolve;
        rejectWrite = reject;
      });
    },
  });
  using _cleanup = onExit(() => app.dispose());
  await app.restore(session.captureSave());
  const before = app.session.captureSave();
  const failed = app.purchaseForgeUpgrade('bench', 'sword');
  assert.equal(app.busy, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.adventure!.forgeUpgrade, 'sword');
  assert.equal(writes[0]!.adventure!.inventory.gold, 8);
  assert.equal(writes[0]!.adventure!.inventory.iron, 6);
  assert.equal(writes[0]!.adventure!.inventory['workshop-temper'], 0);
  assert.deepEqual(
    app.session.captureSave(),
    before,
    'candidate is not live while storage is pending',
  );
  await assert.rejects(app.purchaseForgeUpgrade('bench', 'lantern'), /current operation/);
  await assert.rejects(app.load(), /purchase/);
  await assert.rejects(app.reset('death'), /purchase/);
  assert.throws(() => app.changeInventory({ kind: 'salvage' }), /loading/);
  await assert.rejects(app.save(), /purchase/);
  app.autosave();
  assert.equal(writes.length, 1, 'a stale autosave cannot overwrite the purchase');
  rejectWrite(new Error('Disk full'));
  await assert.rejects(failed, /Disk full/);
  assert.deepEqual(app.session.captureSave(), before);
  assert.equal(app.busy, false);
  assert.equal(
    app.events.history.some((e) => e.kind === 'inventory-changed'),
    false,
  );
  const successful = app.purchaseForgeUpgrade('bench', 'lantern');
  resolveWrite();
  await successful;
  assert.equal(app.session.forgeUpgrade, 'lantern');
  assert.deepEqual(app.session.captureSave(), writes[1]);
  assert.equal(app.events.history.filter((e) => e.kind === 'inventory-changed').length, 1);
  await assert.rejects(app.purchaseForgeUpgrade('bench', 'sword'), /already/);
  assert.equal(writes.length, 2);
});

test('purchase exclusivity is installed before reentrant loading feedback', async () => {
  const session = forgeFixture();
  supplyForge(session);
  let writes = 0;
  const { app } = fixture(sceneFixture(session.registry), {
    saveGame: async () => {
      writes++;
    },
  });
  using _cleanup = onExit(() => app.dispose());
  await app.restore(session.captureSave());
  let attempted: Promise<void> | undefined;
  app.hooks.loading = (active) => {
    if (!active) return;
    attempted = assert.rejects(app.reset(), /purchase/);
    app.autosave();
  };
  await app.purchaseForgeUpgrade('bench', 'sword');
  await attempted;
  assert.equal(writes, 1);
  assert.equal(app.session.forgeUpgrade, 'sword');
  assert.equal(app.busy, false);
});
