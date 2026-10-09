import { SaveContentError } from '../src/core/save';
import { isSupportedPosition } from '../src/content/world';
import { content } from './fixtures/content';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GameSession } from '../src/core/session';
import { Persistence } from '../src/core/persistence';
import {
  parseGame,
  parseSettings,
  SAVE_LIMITS,
  type GameSave,
  type LoadResult,
} from '../src/core/save';
import { sandboxContent } from '../src/content/sandbox-world';
import { defaultVisualEffects } from '../src/content/visual-effects';
import { Store, validateRequest } from '../electron/store';

test('current saves preserve variable counts, health above 100, multiple areas and player cooldowns', () => {
  const session = new GameSession(sandboxContent, 7, 'systems-fixture');
  session.sim.enemies[1]!.health = 121;
  session.sim.hero.cooldown = 57;
  session.sim.hero.dodgeCooldown = 12;
  const save = parseGame(session.captureSave(), sandboxContent),
    restored = new GameSession(sandboxContent);
  restored.restoreSave(save);
  assert.equal(restored.sim.enemies.length, 5);
  assert.equal(restored.sim.enemies[1]!.health, 121);
  assert.equal(restored.sim.hero.cooldown, 57);
  assert.equal(restored.sim.hero.dodgeCooldown, 12);
  assert.ok(restored.generation > 1);
  const unknown = structuredClone(save);
  unknown.area = 'missing';
  assert.throws(() => parseGame(unknown, sandboxContent), /unknown area/);
  const invalid = structuredClone(save);
  invalid.areas['systems-fixture']!.actors['fixture-2']!.health = 141;
  assert.throws(() => parseGame(invalid, sandboxContent), /invalid actor/);
  for (const version of [0, 1, 2]) {
    const old = {
      version,
      seed: 142,
      wins: 3,
      ...(version === 0
        ? {}
        : {
            hero: { x: 0, z: 2.3, health: 55 },
            enemies: [-2.5, 0.2, 2.9].map((x) => ({ x, z: -3.5, health: 70 })),
          }),
      ...(version === 2 ? { area: 1 } : {}),
    };
    const v = parseGame(old, content);
    assert.equal(v.version, 6);
    assert.equal(v.area, version === 2 ? 'upper-landing' : 'court');
    assert.equal(v.player.cooldown, 0);
    assert.equal(v.player.dodgeCooldown, 0);
    assert.equal(v.player.health, version === 0 ? 100 : 55);
    assert.equal(v.wins, 3);
  }
  {
    const previous = prototype(),
      bytes = JSON.stringify(previous),
      save = parseGame(previous, content);
    assert.equal(JSON.stringify(previous), bytes);
    assert.equal(save.version, 6);
    assert.equal(save.player.health, previous.player.health);
    assert.equal(save.player.cooldown, previous.player.cooldown);
    assert.equal(save.player.dodgeCooldown, previous.player.dodgeCooldown);
    assert.equal(save.player.z, 7.5);
    assert.ok(save.areas.court!.cleared);
    assert.equal(Object.keys(save.areas.court!.actors).length, 1);
    assert.deepEqual(
      Object.values(save.areas['upper-landing']!.actors).map((a) => a.health),
      [50, 50],
    );
    assert.equal(save.areas['upper-landing']!.engaged, false);
    previous.player.x = -5.3;
    previous.player.z = -3.4;
    const relocated = parseGame(previous, content);
    assert.equal(relocated.player.x, 0);
    assert.equal(relocated.player.z, 7.5);
    assert.equal(relocated.player.health, 63);
    const unknown = prototype();
    unknown.areas.court.actors['unknown'] = { x: 0, z: 0, health: 0 };
    assert.throws(() => parseGame(unknown, content), SaveContentError);
    assert.deepEqual(
      parseSettings({ version: 2, verticalSpan: 13, renderScale: 1, showDebug: false }),
      {
        version: 5,
        verticalSpan: 13,
        renderScale: 1,
        showDebug: false,
        depthOfField: 1,
        visualEffects: defaultVisualEffects(),
      },
    );
  }
  {
    const previous = {
      version: 4,
      seed: 142,
      wins: 1,
      area: 'upper-landing',
      player: { x: 6, z: 6, health: 54, cooldown: 40, dodgeCooldown: 11 },
      areas: {
        court: { engaged: true, cleared: true, actors: { 'warden-1': { x: 0, z: 0, health: 0 } } },
        'upper-landing': {
          engaged: true,
          cleared: false,
          actors: {
            'warden-1': { x: 1, z: -1, health: 25 },
            'warden-2': { x: 2, z: 0, health: 50 },
          },
        },
      },
    };
    const before = JSON.stringify(previous),
      save = parseGame(previous, content);
    assert.equal(JSON.stringify(previous), before);
    assert.equal(save.version, 6);
    assert.equal(save.player.health, 54);
    assert.equal(save.player.cooldown, 40);
    assert.equal(save.player.dodgeCooldown, 11);
    assert.deepEqual([save.player.x, save.player.z], [0, 7.5]);
    assert.ok(save.areas.court!.cleared);
    assert.equal(save.areas['upper-landing']!.engaged, false);
    assert.deepEqual(
      Object.values(save.areas['upper-landing']!.actors).map((a) => a.health),
      [50, 50],
    );
  }
  {
    const save = { ...new GameSession(content, 142, 'upper-landing').captureSave(), version: 5 };
    Object.assign(save.player, { x: -6.85, z: -5.15, health: 63, cooldown: 17, dodgeCooldown: 8 });
    Object.assign(save.areas['upper-landing']!.actors['warden-1']!, {
      x: 6.15,
      z: -5.45,
      health: 17,
    });
    save.areas['upper-landing']!.engaged = true;
    const original = JSON.stringify(save),
      result = parseGame(save, content);
    assert.equal(JSON.stringify(save), original);
    assert.equal(result.version, 6);
    assert.equal(result.player.health, 63);
    assert.equal(result.player.cooldown, 17);
    assert.equal(result.player.dodgeCooldown, 8);
    assert.ok(isSupportedPosition(content.area('upper-landing'), result.player, 0.3));
    assert.equal(result.areas['upper-landing']!.actors['warden-1']!.health, 17);
    assert.equal(result.areas['upper-landing']!.engaged, true);
    assert.equal(result.areas['upper-landing']!.cleared, false);
    assert.ok(
      isSupportedPosition(
        content.area('upper-landing'),
        result.areas['upper-landing']!.actors['warden-1']!,
        0.3,
      ),
    );
    assert.throws(
      () => parseGame({ ...save, version: 6 }, content),
      /invalid player/,
      'new-format saves must not accept old bounds',
    );
    assert.throws(
      () => parseGame({ ...save, player: { ...save.player, x: 8 } }, content),
      /invalid player/,
      'migration must reject positions outside the old bounds',
    );
    assert.throws(
      () =>
        parseGame(
          {
            ...save,
            areas: { ...save.areas, 'unknown-chapel': save.areas['upper-landing']! },
          },
          content,
        ),
      /unknown area/,
    );
  }
});
test('startup protection requires explicit Load/New; writes snapshot in order and retain failure status', async () => {
  const saved = new GameSession(content).captureSave();
  let value: LoadResult<GameSave> = { status: 'ok', data: saved },
    fail = false;
  const writes: GameSave[] = [];
  const persistence = new Persistence({
    loadGame: async () => value,
    saveGame: async (v) => {
      if (fail) throw new Error('disk full');
      writes.push(v);
    },
  });
  await persistence.inspect();
  assert.equal(persistence.canWrite, false);
  assert.equal(await persistence.save(saved, true), false);
  await assert.rejects(persistence.save(saved));
  assert.equal(writes.length, 0);
  persistence.loaded();
  const first = structuredClone(saved);
  first.wins = 4;
  const pending = persistence.save(first, true);
  first.wins = 999;
  await Promise.all([pending, persistence.save({ ...saved, wins: 5 })]);
  assert.deepEqual(
    writes.map((v) => v.wins),
    [4, 5],
  );
  fail = true;
  await assert.rejects(persistence.save(saved, true), /disk full/);
  assert.equal(persistence.error, 'disk full');
  fail = false;
  await persistence.save(saved);
  assert.equal(persistence.error, '');
  await persistence.inspect();
  persistence.confirmNew();
  await persistence.save(saved);
  value = { status: 'unreadable', message: 'unsupported' };
  await persistence.inspect();
  assert.throws(() => persistence.confirmNew());
  assert.equal(await persistence.save(saved, true), false);
});
test('per-slot size limits, unknown content, unsupported settings and oversized reads preserve files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-systems-save-')),
    store = new Store(dir),
    save = new GameSession(content).captureSave();
  try {
    assert.equal(SAVE_LIMITS.game, 1048576);
    assert.equal(SAVE_LIMITS.settings, 16384);
    assert.throws(
      () =>
        validateRequest('settings', {
          version: 2,
          renderScale: 1,
          showDebug: false,
          verticalSpan: 13,
          extra: 'a'.repeat(17000),
        }),
      /limit/,
    );
    await fs.writeFile(path.join(dir, 'game.bak'), JSON.stringify(save));
    await fs.writeFile(path.join(dir, 'game.json'), JSON.stringify({ ...save, area: 'missing' }));
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', save));
    assert.ok((await fs.readFile(path.join(dir, 'game.json'), 'utf8')).includes('missing'));
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({ version: 6 }));
    assert.equal((await store.load('settings')).status, 'unreadable');
    await assert.rejects(
      store.save('settings', {
        version: 2,
        renderScale: 1,
        showDebug: false,
        verticalSpan: 13,
      }),
      /Newer/,
    );
    await fs.rm(path.join(dir, 'game.bak'));
    await fs.writeFile(path.join(dir, 'game.json'), 'x'.repeat(SAVE_LIMITS.game + 1));
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', save), /oversized/);
    assert.equal((await fs.stat(path.join(dir, 'game.json'))).size, SAVE_LIMITS.game + 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('backup-only saves preserve unreadable, newer and unknown-content data before accepting writes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-backup-only-')),
    store = new Store(dir),
    save = new GameSession(content).captureSave();
  try {
    for (const text of [
      'corrupt',
      JSON.stringify({ ...save, version: 99 }),
      JSON.stringify({ ...save, area: 'missing' }),
      'x'.repeat(SAVE_LIMITS.game + 1),
    ]) {
      await fs.writeFile(path.join(dir, 'game.bak'), text);
      assert.equal((await store.load('game')).status, 'unreadable');
      await assert.rejects(store.save('game', save));
      assert.equal(await fs.readFile(path.join(dir, 'game.bak'), 'utf8'), text);
      await assert.rejects(fs.stat(path.join(dir, 'game.json')), { code: 'ENOENT' });
    }
    await fs.writeFile(path.join(dir, 'game.bak'), JSON.stringify(save));
    assert.equal((await store.load('game')).status, 'recovered');
    await store.save('game', { ...save, wins: 1 });
    const result = await store.load('game');
    assert.equal(result.status, 'ok');
    assert.ok('data' in result && 'wins' in result.data && result.data.wins === 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('short filesystem reads do not make a valid checkpoint unreadable or replace it with its older backup', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-short-read-')),
    store = new Store(directory),
    save = new GameSession(content).captureSave(),
    open = fs.open;
  try {
    await store.save('game', { ...save, wins: 1 });
    await store.save('game', { ...save, wins: 7 });
    fs.open = async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'read')
            return (buffer: Buffer, offset: number, length: number, position: number) =>
              target.read(buffer, offset, Math.min(length, 7), position);
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const loaded = await store.load('game');
    assert.equal(loaded.status, 'ok');
    assert.ok('data' in loaded && 'wins' in loaded.data && loaded.data.wins === 7);
    await store.save('game', { ...save, wins: 8 });
    const next = await store.load('game');
    assert.ok('data' in next && 'wins' in next.data && next.data.wins === 8);
  } finally {
    fs.open = open;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('save migration, newer format rejection, serialized writes, corruption recovery and no automatic overwrite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-save-'));
  const store = new Store(dir),
    value = parseGame({ version: 0, seed: 142, wins: 1 }, content);
  try {
    assert.equal((await store.load('game')).status, 'empty');
    await Promise.all([store.save('game', value), store.save('game', { ...value, wins: 2 })]);
    const loaded = await store.load('game');
    assert.ok('data' in loaded);
    assert.equal((loaded.data as typeof value).wins, 2);
    await fs.writeFile(path.join(dir, 'game.json'), 'corrupt');
    assert.equal((await store.load('game')).status, 'recovered');
    await store.save('game', { ...value, wins: 3 });
    assert.equal(await fs.readFile(path.join(dir, 'game.corrupt'), 'utf8'), 'corrupt');
    await fs.writeFile(path.join(dir, 'game.json'), 'new unreadable');
    await fs.writeFile(path.join(dir, 'game.bak'), 'also unreadable');
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', value));
    assert.equal(await fs.readFile(path.join(dir, 'game.json'), 'utf8'), 'new unreadable');
    assert.throws(() => parseGame({ ...value, version: 99 }, content));
    assert.throws(() => validateRequest('game', { ...value, extra: 'x'.repeat(20000) }));
    await fs.rm(path.join(dir, 'game.bak'));
    await assert.rejects(store.save('game', value));
    assert.equal(await fs.readFile(path.join(dir, 'game.json'), 'utf8'), 'new unreadable');
    await fs.writeFile(path.join(dir, 'game.bak'), JSON.stringify(value));
    await fs.writeFile(path.join(dir, 'game.json'), JSON.stringify({ ...value, version: 99 }));
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', value), /Newer/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('settings migrations preserve quality, zoom, depth and effect preferences and protect unsupported data', () => {
  for (const [legacy, verticalSpan, depthOfField] of [
    [{ version: 1, renderScale: 0.75, showDebug: true }, 9, 1],
    [{ version: 2, verticalSpan: 13, renderScale: 0.75, showDebug: true }, 13, 1],
    [
      { version: 3, verticalSpan: 11, renderScale: 0.75, showDebug: true, depthOfField: 0.45 },
      9,
      0.45,
    ],
    [
      { version: 3, verticalSpan: 15, renderScale: 1, showDebug: false, depthOfField: 0.4 },
      15,
      0.4,
    ],
    [{ version: 4, verticalSpan: 9, renderScale: 1, showDebug: false, depthOfField: 0 }, 9, 0],
    [{ version: 4, verticalSpan: 11, renderScale: 0.5, showDebug: true, depthOfField: 0 }, 11, 0],
  ] as const) {
    assert.deepEqual(parseSettings(legacy), {
      version: 5,
      renderScale: legacy.renderScale,
      showDebug: legacy.showDebug,
      verticalSpan,
      depthOfField,
      visualEffects: defaultVisualEffects(),
    });
  }
  const current = {
    version: 5,
    verticalSpan: 11,
    renderScale: 1,
    showDebug: false,
    depthOfField: 0.45,
    visualEffects: { ...defaultVisualEffects(), rain: false, bloom: false },
  };
  assert.deepEqual(parseSettings(current), current);
  for (const bad of [
    { ...current, version: 6 },
    ...[-0.01, 1.01, NaN].map((depthOfField) => ({ ...current, depthOfField })),
    { version: 2, verticalSpan: 20, renderScale: 1, showDebug: false },
    { ...current, visualEffects: { ...current.visualEffects, outlines: true } },
    { ...current, visualEffects: { ...current.visualEffects, bloom: 1 } },
  ])
    assert.throws(() => parseSettings(bad));
});
test('browser adapter preserves unreadable settings/game bytes and reports unavailable storage without throwing', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
    values = new Map<string, string>();
  let unavailable = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        if (unavailable) throw new Error('storage denied');
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    },
  });
  try {
    const { browserBridge } = await import('../src/platform/browser-store');
    const settings = {
      version: 5 as const,
      visualEffects: defaultVisualEffects(),
      renderScale: 1,
      showDebug: false,
      verticalSpan: 13,
      depthOfField: 1,
    };
    values.set('lantern-settings', '{"version":99}');
    await assert.rejects(browserBridge.saveSettings(settings));
    assert.equal(values.get('lantern-settings'), '{"version":99}');
    values.set('lantern-game', '');
    assert.equal((await browserBridge.loadGame()).status, 'unreadable');
    await assert.rejects(browserBridge.saveGame(new GameSession(content).captureSave()));
    assert.equal(values.get('lantern-game'), '');
    values.clear();
    await browserBridge.saveSettings(settings);
    assert.equal((await browserBridge.loadSettings()).status, 'ok');
    unavailable = true;
    assert.equal((await browserBridge.loadSettings()).status, 'unreadable');
    assert.equal((await browserBridge.loadGame()).status, 'unreadable');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

function prototype() {
  return {
    version: 3,
    seed: 142,
    wins: 1,
    area: 'upper-landing',
    player: { x: 0, z: 6.2, health: 63, cooldown: 70, dodgeCooldown: 12 },
    areas: {
      court: {
        cleared: true,
        actors: Object.fromEntries(
          [1, 2, 3].map((i) => [`warden-${i}`, { x: 0, z: 0, health: 0 }]),
        ),
      },
      'upper-landing': {
        cleared: false,
        actors: Object.fromEntries(
          [1, 2, 3].map((i) => [`warden-${i}`, { x: 0, z: 0, health: i === 1 ? 25 : 70 }]),
        ),
      },
    },
  };
}
