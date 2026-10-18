import { writeJson } from '../../tools/json-file';
import { mockGlobals } from '../fixtures/globals';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { parseSettings } from '../../src/platform/settings';
import { content } from '../../src/content/game-content';
import { content as fixtureContent } from '../fixtures/content';
import { Store } from '../../electron/store';
import { DesktopSession } from '../../electron/session';
import { createBrowserBridge } from '../../src/platform/browser-store';
import { defaultVisualEffects } from '../../src/content/visual-effects';
test('current saves preserve variable actors, vitality, cooldowns and encounter progress', () => {
  const session = new GameSession(fixtureContent, 7, 'upper-landing');
  session.sim.enemies[1]!.health = 41;
  session.sim.hero.cooldown = 57;
  session.sim.hero.dodgeCooldown = 12;
  const restored = new GameSession(fixtureContent);
  restored.restoreSave(parseGame(session.captureSave(), fixtureContent));
  assert.equal(restored.sim.enemies.length, 2);
  assert.equal(restored.sim.enemies[1]!.health, 41);
  assert.equal(restored.sim.hero.cooldown, 57);
  assert.equal(restored.sim.hero.dodgeCooldown, 12);
  const invalid = session.captureSave();
  invalid.area = 'missing';
  assert.throws(() => parseGame(invalid, fixtureContent), /unknown area/);
});
test('obsolete and malformed prototype data reset; adapters snapshot ordered writes and expose I/O failures', async (t) => {
  const directory = await temporaryDirectory(t, 'lantern-store-'),
    store = new Store(directory, content),
    save = new GameSession(content).captureSave();

  for (const value of [
    '{',
    JSON.stringify({ ...save, version: 5 }),
    JSON.stringify({ ...save, version: 99 }),
    JSON.stringify({ ...save, area: 'missing' }),
  ]) {
    await fs.writeFile(path.join(directory, 'game.json'), value);
    assert.deepEqual(
      await store.load('game'),
      value === '{' || JSON.parse(value).version === save.version
        ? { status: 'empty' }
        : { status: 'empty', reason: 'incompatible' },
    );
  }
  const first = store.save('game', save);
  save.wins = 2;
  const second = store.save('game', save);
  save.wins = 99;
  await Promise.all([first, second]);
  const result = await store.load('game');
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.equal((result.data as typeof save).wins, 2);
  await fs.writeFile(path.join(directory, 'settings.json'), 'old');
  assert.deepEqual(await store.load('settings'), { status: 'empty' });
  const settings = {
    version: 7 as const,
    uiScale: 1 as const,
    audio: { master: 0.8, effects: 0.8, ambience: 0.65, muted: false },
    renderScale: 1,
    showDebug: false,
    verticalSpan: 9,
    depthOfField: 0.5,
    visualEffects: defaultVisualEffects(),
  };
  await store.save('settings', settings);
  assert.deepEqual(await store.load('settings'), { status: 'ok', data: settings });
  const custom = new Store(path.join(directory, 'custom'), fixtureContent),
    customSave = new GameSession(fixtureContent).captureSave();
  await custom.save('game', customSave);
  assert.deepEqual(await custom.load('game'), { status: 'ok', data: customSave });
  assert.throws(() => custom.save('game', save), /unknown area/);
  assert.deepEqual(await custom.load('game'), { status: 'ok', data: customSave });
  await writeJson(path.join(directory, 'custom', 'game.json'), save);
  assert.deepEqual(await custom.load('game'), { status: 'empty' });
  await custom.save('settings', settings);
  assert.deepEqual(await custom.load('settings'), { status: 'ok', data: settings });
  assert.throws(() => parseSettings({ ...settings, version: 4 }));
  const blocked = new Store(path.join(directory, 'game.json'), content);
  await assert.rejects(blocked.load('game'));
  await assert.rejects(blocked.save('game', new GameSession(content).captureSave()));
});
test('browser profiles retain old namespaces, reset obsolete data and surface unavailable storage', async (t) => {
  const values = new Map<string, string>([['lantern-game', 'old session']]);

  mockGlobals(t, {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });

  const game = createBrowserBridge(content),
    preview = createBrowserBridge(content, 'preview'),
    sandbox = createBrowserBridge(content, 'sandbox'),
    save = new GameSession(content).captureSave();
  assert.deepEqual(await game.loadGame(), { status: 'empty' });
  await game.saveGame(save);
  assert.equal(values.get('lantern-game'), 'old session');
  assert.deepEqual(await preview.loadGame(), { status: 'empty' });
  await preview.saveGame({ ...save, wins: 4 });
  assert.equal(((await preview.loadGame()) as { data: { wins: number } }).data.wins, 4);
  assert.equal(((await game.loadGame()) as { data: { wins: number } }).data.wins, 0);
  assert.deepEqual(await sandbox.loadGame(), { status: 'empty' });
  await assert.rejects(sandbox.saveGame(save));
  const custom = createBrowserBridge(fixtureContent, 'custom'),
    customSave = new GameSession(fixtureContent).captureSave();
  await custom.saveGame(customSave);
  assert.deepEqual(await custom.loadGame(), { status: 'ok', data: customSave });
  await assert.rejects(custom.saveGame(save), /unknown area/);
  assert.deepEqual(await custom.loadGame(), { status: 'ok', data: customSave });
  values.set('lantern-prototype-custom-game', JSON.stringify(save));
  assert.deepEqual(await custom.loadGame(), { status: 'empty' });
  values.set('lantern-prototype-game-game', '{"version":99}');
  assert.deepEqual(await game.loadGame(), { status: 'empty', reason: 'incompatible' });
  await game.saveGame(save);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('storage unavailable');
    },
  });
  await assert.rejects(game.loadGame(), /storage unavailable/);
});

test('desktop reads participate in admission order and failures do not poison later operations', async (t) => {
  const directory = await temporaryDirectory(t, 'lantern-store-order-');
  const store = new Store(directory, fixtureContent);
  const save = new GameSession(fixtureContent).captureSave();
  await store.save('game', save);
  const opened = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>();
  const originalOpen = fs.open,
    originalMkdir = fs.mkdir;
  const admitted: string[] = [];
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (args[1] === 'r') {
      admitted.push('read');
      opened.resolve();
      await resume.promise;
    }
    return originalOpen(...args);
  });
  t.mock.method(fs, 'mkdir', (...args: Parameters<typeof fs.mkdir>) => {
    admitted.push('write');
    return originalMkdir(...args);
  });
  const reading = store.load('game');
  await opened.promise;
  const writing = store.save('game', { ...save, wins: 7 });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(admitted, ['read'], 'A later write must wait for the admitted read');
  } finally {
    resume.resolve();
  }
  const result = await reading;
  await writing;
  assert.equal(result.status, 'ok');
  if (result.status === 'ok') assert.equal(result.data.wins, 0);
  assert.deepEqual(admitted, ['read', 'write']);
  t.mock.restoreAll();
  await fs.rm(directory, { recursive: true });
  await fs.writeFile(directory, 'blocked directory');
  await assert.rejects(store.load('game'));
  await fs.rm(directory);
  await store.save('game', save);
  assert.equal((await store.load('game')).status, 'ok');
});

test('desktop navigation closes old storage admission and serializes launch ownership', async (t) => {
  const directory = await temporaryDirectory(t, 'lantern-desktop-session-'),
    navigated: string[] = [],
    session = new DesktopSession(
      'game',
      (mode) => new Store(path.join(directory, mode), fixtureContent),
      async (mode) => {
        navigated.push(mode);
      },
    );
  await session.launch('game');
  const writing = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>(),
    originalMkdir = fs.mkdir;
  t.mock.method(fs, 'mkdir', async (...args: Parameters<typeof fs.mkdir>) => {
    writing.resolve();
    await resume.promise;
    return originalMkdir(...args);
  });
  const save = new GameSession(fixtureContent).captureSave(),
    admitted = session.save('game', save);
  await writing.promise;
  const switching = session.launch('sandbox');
  try {
    assert.throws(() => session.save('game', { ...save, wins: 99 }), /not available/);
    assert.throws(() => session.load('settings'), /not available/);
    await assert.rejects(session.launch('editor'), /launch in progress/);
    assert.deepEqual(navigated, ['game'], 'Navigation waits for the closed old queue');
  } finally {
    resume.resolve();
  }
  await admitted;
  await switching;
  assert.deepEqual(navigated, ['game', 'sandbox']);
  assert.deepEqual(await session.load('game'), { status: 'empty' });
  assert.throws(() => session.save('game', save), /writes denied/);
  const original = await new Store(path.join(directory, 'game'), fixtureContent).load('game');
  assert.deepEqual(original, { status: 'ok', data: save });
  await session.dispose();
  await assert.rejects(session.launch('game'), /disposed/);
  assert.throws(() => session.load('settings'), /disposed/);
});

test('destination boot may read settings and failed navigation restores the previous profile', async (t) => {
  const directory = await temporaryDirectory(t, 'lantern-desktop-recovery-'),
    navigated: string[] = [],
    bootReads: string[] = [],
    writing = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>(),
    settings = parseSettings({
      version: 5,
      renderScale: 1,
      showDebug: false,
      verticalSpan: 9,
      depthOfField: 0,
      visualEffects: defaultVisualEffects(),
    });
  let fail = false;
  let destinationWrite: Promise<void> | undefined;
  const session = new DesktopSession(
    'game',
    (mode) => new Store(path.join(directory, mode), fixtureContent),
    async (mode) => {
      navigated.push(mode);
      bootReads.push((await session.load('settings')).status);
      if (fail) {
        fail = false;
        destinationWrite = session.save('settings', settings);
        throw new Error('Navigation failed');
      }
    },
  );
  await session.launch('game');
  const save = new GameSession(fixtureContent).captureSave();
  await session.save('game', save);
  const originalMkdir = fs.mkdir;
  t.mock.method(fs, 'mkdir', async (...args: Parameters<typeof fs.mkdir>) => {
    if (args[0] === path.join(directory, 'editor')) {
      writing.resolve();
      await resume.promise;
    }
    return originalMkdir(...args);
  });
  fail = true;
  const failed = assert.rejects(session.launch('editor'), /Navigation failed/);
  await writing.promise;
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.throws(() => session.load('settings'), /not available/);
    assert.deepEqual(navigated, ['game', 'editor'], 'Recovery drains admitted destination writes');
  } finally {
    resume.resolve();
  }
  await failed;
  await destinationWrite;
  assert.equal(session.mode, 'game');
  assert.deepEqual(navigated, ['game', 'editor', 'game']);
  assert.deepEqual(await session.load('game'), { status: 'ok', data: save });
  await session.launch('editor');
  assert.equal(session.mode, 'editor');
  assert.deepEqual(bootReads, ['empty', 'empty', 'empty', 'ok']);
  assert.deepEqual(await session.load('settings'), { status: 'ok', data: settings });
  await session.dispose();
});

test('failed desktop recovery blocks storage; shutdown prevents late navigation', async (t) => {
  const directory = await temporaryDirectory(t, 'lantern-desktop-closed-');
  let fail = false;
  const session = new DesktopSession(
    'game',
    (mode) => new Store(path.join(directory, mode), fixtureContent),
    async () => {
      if (fail) throw new Error('Cannot navigate');
    },
  );
  await session.launch('game');
  fail = true;
  await assert.rejects(session.launch('editor'), /launch and recovery failed/);
  assert.throws(() => session.load('settings'), /not available/);
  fail = false;
  await session.launch('sandbox');
  assert.equal(session.mode, 'sandbox');
  await session.dispose();

  const draining = Promise.withResolvers<void>();
  let navigation = 0;
  const closing = new DesktopSession(
    'game',
    (mode) =>
      Object.assign(new Store(path.join(directory, mode), fixtureContent), {
        drain: () => draining.promise,
      }),
    async () => {
      navigation++;
    },
  );
  const pending = closing.launch('editor');
  const disposed = closing.dispose();
  draining.resolve();
  await disposed;
  await assert.rejects(pending, /disposed/);
  assert.equal(navigation, 0);
});

test('desktop shutdown revokes admission immediately and waits for every admitted atomic write', async (t) => {
  const directory = await temporaryDirectory(t, 'lantern-desktop-shutdown-'),
    session = new DesktopSession(
      'game',
      () => new Store(directory, fixtureContent),
      async () => {},
    );
  await session.launch('game');
  const replacing = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>(),
    originalRename = fs.rename;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    replacing.resolve();
    await resume.promise;
    return originalRename(...args);
  });
  const first = new GameSession(fixtureContent).captureSave(),
    last = { ...first, wins: 9 },
    admitted = Promise.all([session.save('game', first), session.save('game', last)]);
  await replacing.promise;
  let drained = false;
  const closing = session.dispose();
  const observed = closing.then(() => {
    drained = true;
  });
  try {
    assert.equal(session.dispose(), closing, 'Repeated shutdown shares the captured queue');
    assert.throws(() => session.save('game', first), /disposed/);
    assert.throws(() => session.load('settings'), /disposed/);
    await assert.rejects(session.launch('editor'), /disposed/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drained, false, 'Process exit must wait for file replacement');
  } finally {
    resume.resolve();
    await admitted;
    await observed;
  }
  assert.deepEqual(await new Store(directory, fixtureContent).load('game'), {
    status: 'ok',
    data: last,
  });
  assert.deepEqual(await fs.readdir(directory), ['game.json']);
});

test('desktop storage round-trips either permanent campfire improvement with its paid balances', async (t) => {
  const { upgradeFixture, supplyUpgrades } = await import('../fixtures/upgrades');
  const directory = await temporaryDirectory(t, 'lantern-upgrade-save-');
  for (const choice of ['sword', 'lantern'] as const) {
    const session = upgradeFixture();
    supplyUpgrades(session);
    const purchase = session.prepareUpgradePurchase('camp/arrival', choice);
    const store = new Store(path.join(directory, choice), session.registry);
    await store.save('game', purchase.save);
    purchase.commit();
    const saved = await store.load('game');
    assert.equal(saved.status, 'ok');
    if (saved.status !== 'ok') assert.fail('Expected purchased checkpoint');
    const resumed = new GameSession(session.registry);
    resumed.restoreSave(saved.data);
    assert.deepEqual(resumed.upgrades, { [choice]: 1 });
    resumed.sim.hero.health = 0;
    resumed.resetCurrentArea('death');
    assert.deepEqual(resumed.upgrades, { [choice]: 1 });
    assert.deepEqual(resumed.inventory, session.inventory);
    const target = resumed.sim.enemies[0]!;
    const health = target.health;
    resumed.sim.damage(resumed.sim.hero, target, 26);
    assert.equal(health - target.health, choice === 'sword' ? 52 : 26);
  }
});
