import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GameSession } from '../../src/core/session';
import { parseGame, parseSettings } from '../../src/core/save';
import { content } from '../../src/content/game-content';
import { content as fixtureContent } from '../fixtures/content';
import { Store } from '../../electron/store';
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
test('obsolete and malformed prototype data reset; adapters snapshot ordered writes and expose I/O failures', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-store-')),
    store = new Store(directory),
    save = new GameSession(content).captureSave();
  try {
    for (const value of [
      '{',
      JSON.stringify({ ...save, version: 5 }),
      JSON.stringify({ ...save, version: 99 }),
      JSON.stringify({ ...save, area: 'missing' }),
    ]) {
      await fs.writeFile(path.join(directory, 'game.json'), value);
      assert.deepEqual(await store.load('game'), { status: 'empty' });
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
      version: 5 as const,
      renderScale: 1,
      showDebug: false,
      verticalSpan: 9,
      depthOfField: 0.5,
      visualEffects: defaultVisualEffects(),
    };
    await store.save('settings', settings);
    assert.deepEqual(await store.load('settings'), { status: 'ok', data: settings });
    assert.throws(() => parseSettings({ ...settings, version: 4 }));
    const blocked = new Store(path.join(directory, 'game.json'));
    await assert.rejects(blocked.load('game'));
    await assert.rejects(blocked.save('game', new GameSession(content).captureSave()));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test('browser profiles retain old namespaces, reset obsolete data and surface unavailable storage', async () => {
  const values = new Map<string, string>([['lantern-game', 'old session']]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  try {
    const game = createBrowserBridge(),
      preview = createBrowserBridge('preview'),
      sandbox = createBrowserBridge('sandbox'),
      save = new GameSession(content).captureSave();
    assert.deepEqual(await game.loadGame(), { status: 'empty' });
    await game.saveGame(save);
    assert.equal(values.get('lantern-game'), 'old session');
    assert.deepEqual(await preview.loadGame(), { status: 'empty' });
    await assert.rejects(sandbox.saveGame(save));
    values.set('lantern-prototype-game-game', '{"version":99}');
    assert.deepEqual(await game.loadGame(), { status: 'empty' });
    await game.saveGame(save);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage unavailable');
      },
    });
    await assert.rejects(game.loadGame(), /storage unavailable/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
