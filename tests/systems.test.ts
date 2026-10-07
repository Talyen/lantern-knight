import {readAsset} from '../tools/assets/io';
import {defaultVisualEffects} from '../src/content/visual-effects';
import {sandboxContent} from '../src/content/sandbox-world';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {Texture, Vector3} from 'three';
import {
  content,
  contentDefinitions,
  ContentRegistry,
  PLAYER_ID,
  heightAt,
  surfaceGradient,
} from '../src/content/world';
import {GameSession} from '../src/core/session';
import {Simulation, FixedClock} from '../src/core/simulation';
import {
  parseGame,
  SAVE_LIMITS,
  type GameSave,
  type LoadResult,
} from '../src/core/save';
import {Persistence} from '../src/core/persistence';
import {EventHub, type AnimationEvent} from '../src/core/events';
import {AssetRuntime, pageIdentity} from '../src/assets/loader';
import {ActorSprite} from '../src/presentation/sprite';
import {makeCamera, walkablePoint} from '../src/core/camera';
import {Input} from '../src/core/input';
import {Animator} from '../src/core/animation';
import {Store, validateRequest} from '../electron/store';
import {parseManifest, type Manifest} from '../src/assets/schema';
const still = {move: {x: 0, z: 0}, aim: {x: 0, z: 0}};

test('first click after an aim reset uses the click position without requiring pointer movement', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    target = new EventTarget(),
    canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({left: 80, top: 70, width: 800, height: 600, right: 880, bottom: 670}),
    });
  Object.defineProperty(globalThis, 'window', {configurable: true, value: target});
  const input = new Input(canvas as unknown as HTMLCanvasElement, makeCamera(4 / 3), () => {});
  try {
    const sim = new Simulation(), rect = canvas.getBoundingClientRect();
    for (const button of [0, 2]) {
      input.resetAim();
      const clientX = 650, clientY = 320;
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), {button, clientX, clientY}));
      const cmd = input.consume(sim.hero, sim.areaDefinition, sim.generation),
        point = walkablePoint(input.camera, clientX, clientY, rect, sim.areaDefinition)!;
      assert.ok(Math.abs(cmd.aim.x - point.x) < 1e-7);
      assert.ok(Math.abs(cmd.aim.z - point.z) < 1e-7);
      assert.equal(cmd.attack, button === 0);
      assert.equal(cmd.ability, button === 2);
    }
  } finally {
    input.dispose();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
function clear(session: GameSession) {
  session.sim.enemies.forEach((a) =>
    session.sim.damage(session.sim.hero, a, 10000),
  );
  session.step(still);
}
function enter(session: GameSession, exit: string) {
  return session.commitTransition(session.prepareTransition(exit));
}

test('content rejects duplicate/unknown IDs and invalid numbers, bounds, ramps and exits', () => {
  for (const mutate of [
    (d: typeof contentDefinitions) => (d.areas = [...d.areas, d.areas[0]!]),
    (d: typeof contentDefinitions) => (d.actors[0]!.radius = NaN),
    (d: typeof contentDefinitions) => (d.areas[0]!.bounds.maxX = -10),
    (d: typeof contentDefinitions) =>
      (d.areas[0]!.spawns[0]!.actor = 'missing'),
    (d: typeof contentDefinitions) => (d.areas[0]!.exits[0]!.entry = 'missing'),
    (d: typeof contentDefinitions) =>
      (d.areas[1]!.surface = {
        kind: 'ramp',
        axis: 'z',
        start: 0,
        end: 0,
        startHeight: 0,
        endHeight: 1,
      }),
  ]) {
    const definitions = structuredClone(contentDefinitions);
    mutate(definitions);
    assert.throws(() => new ContentRegistry(definitions));
  }
});
test('third area and melee profile have independent counts, health, radius, movement, timing and bounds', () => {
  const s = new Simulation(12, 'systems-fixture',1,sandboxContent);
  assert.equal(s.enemies.length, 5);
  const heavy = s.enemies.find((a) => a.definition.id === 'heavy-warden')!;
  assert.equal(heavy.health, 140);
  assert.equal(heavy.definition.radius, 0.35);
  s.move(heavy, 100, 100);
  assert.equal(heavy.x, 4.65);
  assert.equal(heavy.z, 5.65);
  s.actors.reverse();
  assert.equal(s.hero.id, PLAYER_ID);
  assert.equal(s.hero.definition.id, 'lamplighter');
  const a = s.enemies.find((a) => a.definition.id === 'warden')!;
  Object.assign(s.hero, {x: 0, z: 0, y: heightAt(s.areaDefinition, 0, 0)});
  Object.assign(a, {x: 0.1, z: 0, y: s.hero.y, stun: 10000});
  Object.assign(heavy, {x: 1, z: 0, y: s.hero.y, stun: 0});
  s.actors = [s.hero, heavy, a];
  s.start(heavy, 'attack', -Math.PI / 2);
  heavy.age = heavy.definition.melee.windup;
  const result = s.step(still);
  assert.equal(s.hero.health, 80);
  assert.ok(result.events.some((e) => e.kind === 'damage' && e.amount === 20));
});
test('x-ramp support, slope and pointer ray share the same surface independently of fixture axes', () => {
  const area = sandboxContent.area('systems-fixture'),
    camera = makeCamera(16 / 9),
    rect = {left: 80, top: 70, width: 2560, height: 1440};
  for (const x of [-4, -0.5, 1, 4]) {
    const p = new Vector3(x, heightAt(area, x, 0), 0),
      ndc = p.clone().project(camera),
      q = walkablePoint(
        camera,
        rect.left + ((ndc.x + 1) * rect.width) / 2,
        rect.top + ((1 - ndc.y) * rect.height) / 2,
        rect,
        area,
      )!;
    assert.ok(p.distanceTo(q) < 1e-7);
  }
  assert.ok(Math.abs(surfaceGradient(area, 0, 0).x - 0.1) < 1e-10);
  assert.deepEqual(surfaceGradient(area, 4, 0), {x: 0, z: 0});
});
test('partial and cleared revisits preserve enemies; player cooldowns survive; enemy transient state clears', () => {
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.exits[0]!.requiresClear = false;
  definitions.areas[1]!.exits[0]!.requiresClear = false;
  const session = new GameSession(new ContentRegistry(definitions));
  const enemy = session.sim.enemies[0]!;
  enemy.health = 25;
  enemy.x = -1;
  enemy.stun = 20;
  session.sim.start(enemy, 'attack');
  session.sim.hero.health = 63;
  session.sim.hero.cooldown = 100;
  session.sim.hero.dodgeCooldown = 20;
  enter(session, 'landing');
  assert.equal(session.sim.hero.z, 7.5);
  assert.equal(session.sim.hero.cooldown, 100);
  assert.equal(session.sim.hero.health, 63);
  enter(session, 'court');
  const restored = session.sim.enemies.find((a) => a.id === enemy.id)!;
  assert.equal(restored.health, 25);
  assert.equal(restored.x, -1);
  assert.equal(restored.stun, 0);
  assert.equal(restored.state, 'idle');
  assert.equal(session.sim.hero.dodgeCooldown, 20);
  clear(session);
  assert.equal(session.wins, 1);
  enter(session, 'landing');
  enter(session, 'court');
  session.step(still);
  assert.ok(session.sim.cleared);
  assert.ok(session.sim.enemies.every((a) => a.health === 0));
  assert.equal(session.wins, 1);
});
test('death resets only current area and failed/superseded transitions cannot commit', () => {
  const session = new GameSession();
  clear(session);
  const first = session.prepareTransition('landing'),
    second = session.prepareTransition('landing'),
    before = session.sim;
  assert.throws(() => session.commitTransition(first), /stale/);
  assert.equal(session.sim, before);
  session.cancelTransition(second);
  assert.equal(session.sim, before);
  assert.ok(!session.loading);
  enter(session, 'landing');
  session.sim.damage(session.sim.enemies[0]!, session.sim.hero, 1000);
  session.sim.hero.age = 45;
  session.step(still);
  assert.equal(session.resetCount, 1);
  assert.equal(session.sim.hero.health, 100);
  assert.ok(session.sim.enemies.every((a) => a.health === 50));
  clear(session);
  enter(session, 'court');
  assert.ok(session.sim.cleared);
  assert.equal(session.sim.enemies[0]!.health, 0);
});
test('v5 saves preserve variable counts, health above 100, multiple areas and player cooldowns', () => {
  const session = new GameSession(sandboxContent, 7, 'systems-fixture');
  session.sim.enemies[1]!.health = 121;
  session.sim.hero.cooldown = 57;
  session.sim.hero.dodgeCooldown = 12;
  const save = parseGame(session.captureSave(),sandboxContent),
    restored = new GameSession(sandboxContent);
  restored.restoreSave(save);
  assert.equal(restored.sim.enemies.length, 5);
  assert.equal(restored.sim.enemies[1]!.health, 121);
  assert.equal(restored.sim.hero.cooldown, 57);
  assert.equal(restored.sim.hero.dodgeCooldown, 12);
  assert.ok(restored.generation > 1);
  const unknown = structuredClone(save);
  unknown.area = 'missing';
  assert.throws(() => parseGame(unknown,sandboxContent), /unknown area/);
  const invalid = structuredClone(save);
  invalid.areas['systems-fixture']!.actors['fixture-2']!.health = 141;
  assert.throws(() => parseGame(invalid,sandboxContent), /invalid actor/);
  for (const version of [0, 1, 2]) {
    const old = {
      version,
      seed: 142,
      wins: 3,
      ...(version === 0
        ? {}
        : {
            hero: {x: 0, z: 2.3, health: 55},
            enemies: [-2.5, 0.2, 2.9].map((x) => ({x, z: -3.5, health: 70})),
          }),
      ...(version === 2 ? {area: 1} : {}),
    };
    const v = parseGame(old);
    assert.equal(v.version, 5);
    assert.equal(v.area, version === 2 ? 'upper-landing' : 'court');
    assert.equal(v.player.cooldown, 0);
    assert.equal(v.wins, 3);
  }
});
test('startup protection requires explicit Load/New; writes snapshot in order and retain failure status', async () => {
  const saved = new GameSession().captureSave();
  let value: LoadResult<GameSave> = {status: 'ok', data: saved},
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
  await Promise.all([pending, persistence.save({...saved, wins: 5})]);
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
  value = {status: 'unreadable', message: 'unsupported'};
  await persistence.inspect();
  assert.throws(() => persistence.confirmNew());
  assert.equal(await persistence.save(saved, true), false);
});
test('per-slot size limits, unknown content, unsupported settings and oversized reads preserve files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-systems-save-')),
    store = new Store(dir),
    save = new GameSession().captureSave();
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
    await fs.writeFile(
      path.join(dir, 'game.json'),
      JSON.stringify({...save, area: 'missing'}),
    );
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', save));
    assert.ok(
      (await readAsset(path.join(dir, 'game.json'), 'utf8')).includes(
        'missing',
      ),
    );
    await fs.writeFile(
      path.join(dir, 'settings.json'),
      JSON.stringify({version: 6}),
    );
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
    await fs.writeFile(
      path.join(dir, 'game.json'),
      'x'.repeat(SAVE_LIMITS.game + 1),
    );
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', save), /oversized/);
    assert.equal(
      (await fs.stat(path.join(dir, 'game.json'))).size,
      SAVE_LIMITS.game + 1,
    );
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});
test('backup-only saves preserve unreadable, newer and unknown-content data before accepting writes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-backup-only-')),
    store = new Store(dir), save = new GameSession().captureSave();
  try {
    for (const text of ['corrupt', JSON.stringify({...save, version: 99}), JSON.stringify({...save, area: 'missing'}), 'x'.repeat(SAVE_LIMITS.game + 1)]) {
      await fs.writeFile(path.join(dir, 'game.bak'), text);
      assert.equal((await store.load('game')).status, 'unreadable');
      await assert.rejects(store.save('game', save));
      assert.equal(await readAsset(path.join(dir, 'game.bak'), 'utf8'), text);
      await assert.rejects(fs.stat(path.join(dir, 'game.json')), {code: 'ENOENT'});
    }
    await fs.writeFile(path.join(dir, 'game.bak'), JSON.stringify(save));
    assert.equal((await store.load('game')).status, 'recovered');
    await store.save('game', {...save, wins: 1});
    const result = await store.load('game');
    assert.equal(result.status, 'ok');
    assert.ok('data' in result && 'wins' in result.data && result.data.wins === 1);
  } finally {
    await fs.rm(dir, {recursive: true, force: true});
  }
});

test('smoke profiles never delete user-supplied directories, including on launch failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-profile-review-'));
  try {
    await fs.writeFile(path.join(directory, 'game.json'), 'existing player save');
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('tools/desktop-smoke.ts'), '--profile', directory, '--output', path.join(directory, 'evidence')], {
      env: {...process.env, LANTERN_EXECUTABLE: path.join(directory, 'missing-executable')}, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(await readAsset(path.join(directory, 'game.json'), 'utf8'), 'existing player save');
    assert.ok(!(await fs.readdir(directory)).some(name => name.startsWith('lantern-smoke-')));
    assert.ok(await fs.stat(path.join(directory, 'evidence/failure.json')));
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
test('step events are immutable captured values; catch-up delivers all once and disposal rejects late work', () => {
  const s = new Simulation(),
    hub = new EventHub();
  hub.setGeneration(s.generation);
  const received: string[] = [],
    dispose = hub.subscribe((e) => received.push(e.key));
  s.enemies[0]!.health = 5;
  s.damage(s.hero, s.enemies[0]!, 26);
  const damage = s.events.find((e) => e.kind === 'damage')!;
  assert.equal(damage.kind, 'damage');
  if (damage.kind === 'damage') assert.equal(damage.amount, 5);
  const position = damage.position;
  s.hero.x = 3;
  assert.notEqual(position[0], s.hero.x);
  assert.ok(Object.isFrozen(damage));
  assert.ok(Object.isFrozen(s.events));
  hub.publish(s.events);
  hub.publish(s.events);
  assert.equal(received.length, 2);
  const combat = new Simulation();
  combat.actors = [combat.hero, combat.enemies[0]!];
  Object.assign(combat.hero, {x: 0, z: 1, aim: Math.PI});
  Object.assign(combat.enemies[0]!, {x: 0, z: 0, stun: 10000});
  combat.startSword(combat.hero, 0);
  combat.hero.age = 9;
  const delivery = new EventHub(),
    kinds: string[] = [],
    lifetimes: AbortSignal[] = [];
  delivery.setGeneration(combat.generation);
  const remove = delivery.subscribe((event, lifetime) => {
    kinds.push(event.kind);
    lifetimes.push(lifetime);
  });
  const clock = new FixedClock();
  clock.advance(100, () => {
    const result = combat.step(still);
    delivery.publish(result.events);
  });
  assert.deepEqual(kinds, ['strike', 'damage']);
  assert.equal(combat.events.length, 0);
  delivery.setGeneration(combat.generation + 1);
  assert.ok(lifetimes.every((s) => s.aborted));
  remove();
  const visual: AnimationEvent = {
    ...damage,
    key: 'visual-one',
    kind: 'animation-notify',
    notify: 'whoosh',
    clip: 'attack',
    instance: 2,
    timeMs: 20,
  };
  hub.publish([visual, visual]);
  assert.equal(received.filter((k) => k === 'visual-one').length, 1);
  dispose();
  hub.publish([{...visual, key: 'visual-two', timeMs: 30}]);
  const length = received.length;
  hub.setGeneration(s.generation + 1);
  hub.publish([visual]);
  assert.equal(received.length, length);
  hub.dispose();
});
test('valid unsorted clip notifications reach consumers chronologically without losing earlier events', async () => {
  const manifest = JSON.parse(await readAsset('public/generated/manifest.json', 'utf8')) as Manifest;
  const clip = manifest.asset.clips.walk!.d45!;
  clip.notifies = [{id: 'later', atMs: 150, kind: 'whoosh'}, {id: 'earlier', atMs: 50, kind: 'dust'}, {id: 'together', atMs: 150, kind: 'flash'}];
  parseManifest(manifest);
  const animator = new Animator(PLAYER_ID, clip), sim = new Simulation(), hub = new EventHub(), received: string[] = [];
  hub.setGeneration(sim.generation);
  hub.subscribe(e => {if (e.kind === 'animation-notify') received.push(e.notify);});
  const base = sim.emit(sim.hero, {kind: 'strike'});
  const publish = () => hub.publish(animator.advance(200).map(n => ({...base, key: n.key, kind: 'animation-notify', notify: n.kind, clip: 'walk', instance: n.instance, timeMs: n.timeMs})));
  publish();
  assert.deepEqual(received, ['dust', 'whoosh', 'flash']);
  animator.start(clip);
  publish();
  assert.deepEqual(received, ['dust', 'whoosh', 'flash', 'dust', 'whoosh', 'flash']);
  assert.deepEqual(clip.notifies.map(n => n.id), ['later', 'earlier', 'together']);
  hub.dispose();
});
test('independent manifests isolate frame/page IDs and share compatible page resources with release-once leases', async () => {
  const primary = JSON.parse(
      await readAsset('public/generated/manifest.json', 'utf8'),
    ) as Manifest,
    other = structuredClone(primary);
  other.asset.id = 'registration-fixture';
  other.asset.canvas = [448, 512];
  other.asset.anchor = [224, 412];
  other.asset.density = 144;
  other.frames.forEach((f) => {
    f.trim[0] += 32;
    f.trim[1] += 64;
    for (const point of Object.values(f.attachments)) {
      point[0] += 32;
      point[1] += 64;
    }
  });
  let decoded = 0,
    disposed = 0;
  const runtime = new AssetRuntime(
    {first: 'generated/first.json', second: 'generated/second.json'},
    false,
    async (url) =>
      new Response(
        JSON.stringify(String(url).includes('first') ? primary : other),
      ),
    async () => {
      decoded++;
      return new Texture();
    },
    () => disposed++,
  );
  const [a, b] = await Promise.all([
    runtime.loadPack('first'),
    runtime.loadPack('second'),
  ]);
  assert.equal(decoded, primary.pages.length);
  assert.equal(a.textures.get('atlas-0'), b.textures.get('atlas-0'));
  const camera = makeCamera(16 / 9),
    foot = new Vector3(1, 0, 2),
    sa = new ActorSprite(
      'a',
      a.manifest,
      a.textures,
      a.manifest.asset.clips.walk!.d45!,
    ),
    sb = new ActorSprite(
      'b',
      b.manifest,
      b.textures,
      b.manifest.asset.clips.walk!.d45!,
    );
  sa.animator.advance(200);
  sb.animator.advance(500);
  sa.show(sa.animator.frame, foot, camera);
  sb.show(sb.animator.frame, foot, camera);
  assert.equal(sa.mesh.position.distanceTo(sb.mesh.position), 0);
  assert.notEqual(
    sa.geometry.getAttribute('position').getX(0),
    sb.geometry.getAttribute('position').getX(0),
  );
  sa.dispose();
  sb.dispose();
  a.release();
  a.release();
  assert.equal(disposed, 0);
  b.release();
  assert.equal(disposed, decoded);
  assert.equal(runtime.pool.entries.size, 0);
  const different = structuredClone(primary.pages[0]!);
  different.hash = 'f'.repeat(64);
  assert.notEqual(pageIdentity(different), pageIdentity(primary.pages[0]!));
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
    const {browserBridge} = await import('../src/platform/browser-store');
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
    await assert.rejects(
      browserBridge.saveGame(new GameSession().captureSave()),
    );
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

test('build proof ignores mutable Finder metadata but rejects app tampering, mismatched commits and dirty CI reuse', async () => {
  const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'lantern-build-proof-'),
    ),
    tool = path.resolve('tools/build-identity.ts'),
    env = {...process.env};
  delete env.GITHUB_SHA;
  const run = (args: string[] = [], overrides: Record<string, string> = {}) =>
    spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), tool, ...args],
      {cwd: directory, env: {...env, ...overrides}, encoding: 'utf8'},
    );
  try {
    await fs.mkdir(path.join(directory, 'dist'));
    await fs.mkdir(path.join(directory, 'dist-electron'));
    await fs.writeFile(path.join(directory, 'dist/app.js'), 'original');
    await fs.writeFile(path.join(directory, 'dist-electron/main.cjs'), 'main');
    await fs.writeFile(path.join(directory, 'dist/.DS_Store'), 'finder-one');
    assert.equal(run(['--write']).status, 0);
    const identityPath = path.join(directory, 'dist/build-identity.json'),
      identity = JSON.parse(await readAsset(identityPath, 'utf8'));
    assert.equal(identity.files['dist/.DS_Store'], undefined);
    await fs.writeFile(path.join(directory, 'dist/.DS_Store'), 'finder-two');
    assert.equal(run().status, 0);
    await fs.writeFile(path.join(directory, 'dist/app.js'), 'tampered');
    const changed = run();
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /build artifact files differ/);
    await fs.writeFile(path.join(directory, 'dist/app.js'), 'original');
    identity.sourceCommit = 'a'.repeat(40);
    identity.dirty = false;
    await fs.writeFile(identityPath, JSON.stringify(identity));
    assert.match(
      run([], {GITHUB_SHA: 'b'.repeat(40)}).stderr,
      /another commit/,
    );
    identity.dirty = true;
    await fs.writeFile(identityPath, JSON.stringify(identity));
    assert.match(
      run([], {GITHUB_SHA: identity.sourceCommit}).stderr,
      /clean source identity/,
    );
    identity.dirty = false;
    await fs.writeFile(identityPath, JSON.stringify(identity));
    assert.equal(run([], {GITHUB_SHA: identity.sourceCommit}).status, 0);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
