import { projectRoot } from '../tools/assets/paths';

import { assetFile } from '../tools/assets/paths';
import { readAsset } from '../tools/assets/io';
import { defaultVisualEffects } from '../src/content/visual-effects';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vector3 } from 'three';
import {
  makeCamera,
  resizeCamera,
  groundPoint,
  selectDirection,
  screenMovement,
  trimmedBounds,
  calibrationFixture,
  contract,
} from '../src/core/camera';
import { Animator, frameAt } from '../src/core/animation';
import { Simulation, FixedClock } from '../src/core/simulation';
import { tuning } from '../src/content/gameplay';
import { parseSource, parseManifest, type Clip } from '../src/assets/schema';
import { compile, exactSource, paddedPixels } from '../tools/compiler';
import { ResourcePool } from '../src/assets/loader';
import { Store, validateRequest } from '../electron/store';
import { parseGame } from '../src/core/save';
import { parseSettings } from '../src/core/save';
import sharp from 'sharp';
import { resourcePath, trustedSender } from '../electron/security';
import { attackDefinition } from '../src/content/gameplay';
import { content, heightAt, PLAYER_ID } from '../src/content/world';
import { GameSession } from '../src/core/session';
import { walkablePoint } from '../src/core/camera';
const approx = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const read = async (p: string) => JSON.parse(await readAsset(p, 'utf8'));
const source = await read('tests/fixtures/valid.json');
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-source-fixture-'));
await fs.writeFile(path.join(fixtureRoot, 'valid.json'), JSON.stringify(source));
await sharp({
  create: {
    width: source.asset.canvas[0],
    height: source.asset.canvas[1],
    channels: 4,
    background: { r: 170, g: 70, b: 20, alpha: 1 },
  },
})
  .png()
  .toFile(path.join(fixtureRoot, 'sample.png'));
import { after } from 'node:test';
after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));
const manifest = await read('public/generated/ink/ink-hero-current/manifest.json');
test('camera projection/unprojection accounts for canvas offset and both aspect ratios', () => {
  const camera = makeCamera(16 / 9);
  for (const [width, height] of [
    [2560, 1440],
    [1200, 900],
  ]) {
    resizeCamera(camera, width!, height!);
    const rect = { left: 103, top: 78, width: width!, height: height! };
    for (const p of [new Vector3(1, 0, 2), new Vector3(-3, 0, -2), new Vector3()]) {
      const ndc = p.clone().project(camera),
        q = groundPoint(
          camera,
          rect.left + ((ndc.x + 1) / 2) * rect.width,
          rect.top + ((1 - ndc.y) / 2) * rect.height,
          rect,
        )!;
      approx(q.x, p.x);
      approx(q.z, p.z);
    }
    approx(camera.top - camera.bottom, contract.verticalSpan);
  }
  const fixture = calibrationFixture();
  assert.ok(fixture.headings[1]!.screenVector[1]! > 0);
  assert.ok(fixture.headings[5]!.screenVector[1]! < 0);
  assert.equal(fixture.view.length, 16);
});
test('trim placement preserves every source pixel relative to the foot; heading wrap, ties and screen movement', () => {
  const a = { density: 192, anchor: [192, 348] },
    b = trimmedBounds(a, [30, 70, 200, 270]);
  approx(b.left, (30 - 192) / 192);
  approx(b.top, (348 - 70) / 192);
  approx(b.left + 70 / 192, (100 - 192) / 192);
  assert.equal(selectDirection(-Math.PI / 4), 'd315');
  assert.equal(selectDirection(Math.PI * 2), 'd00');
  assert.equal(selectDirection(Math.PI / 8), 'd45');
  assert.equal(selectDirection(Math.PI / 8 + 0.01, 'd00'), 'd00');
  assert.throws(() => selectDirection(NaN));
  const v = screenMovement(1, 1);
  approx(Math.hypot(v.x, v.z), 1);
  assert.ok(screenMovement(0, 1).x < 0);
});
test('all compiled clip/direction frames preserve the same untrimmed foot origin', () => {
  const m = parseManifest(manifest),
    asset = m.asset;
  for (const frame of m.frames) {
    const bounds = trimmedBounds(frame.registration ?? asset, frame.trim);
    approx(
      bounds.left +
        ((frame.registration ?? asset).anchor[0] - frame.trim[0]) /
          (frame.registration ?? asset).density,
      0,
    );
    approx(
      bounds.top -
        ((frame.registration ?? asset).anchor[1] - frame.trim[1]) /
          (frame.registration ?? asset).density,
      0,
    );
  }
  for (const dirs of Object.values(m.asset.clips))
    for (const c of Object.values(dirs))
      for (const id of c.frames) assert.ok(m.frames.some((f) => f.id === id));
});
test('vertical actor depth preserves baked projection exactly and places head above the foot in world space', () => {
  const camera = makeCamera(16 / 9),
    angle = (contract.elevationDeg * Math.PI) / 180,
    foot = new Vector3(1, 0, 2);
  for (const [x, y] of [
    [-0.4, -0.3],
    [0.6, 1.8],
    [0, 0],
  ]) {
    const facing = new Vector3(x, y, 0).applyQuaternion(camera.quaternion).add(foot),
      vertical = new Vector3(x, y, y! * Math.tan(angle))
        .applyQuaternion(camera.quaternion)
        .add(foot);
    const a = facing.project(camera),
      b = vertical.clone().project(camera);
    approx(a.x, b.x);
    approx(a.y, b.y);
    approx(vertical.y, y! / Math.cos(angle));
  }
});
test('valid and deliberately invalid schema fixtures; production fails closed', async () => {
  parseSource(source);
  for (const name of ['invalid-duration', 'invalid-camera', 'invalid-heading'])
    assert.throws(() => parseSource(JSON.parse(requireText(name))));
  function requireText(name: string) {
    return fixtureTexts[name]!;
  }
  assert.throws(() => parseSource(source, true), /production/);
  const duplicate = structuredClone(source);
  duplicate.frames.push(duplicate.frames[0]);
  assert.throws(() => parseSource(duplicate), /duplicate/);
  const invalid = structuredClone(manifest);
  invalid.frames[0].rect[2] = 99999;
  assert.throws(() => parseManifest(invalid), /bounds/);
  invalid.frames[0].rect[2] = 1;
  invalid.frames[0].rotated = true;
  assert.throws(() => parseManifest(invalid));
  const nonFinite = structuredClone(source);
  nonFinite.asset.density = Infinity;
  assert.throws(() => parseSource(nonFinite));
  const missingDep = structuredClone(manifest);
  missingDep.bundles.room.dependencies = ['missing'];
  assert.throws(() => parseManifest(missingDep), /dependency/);
  missingDep.bundles.room.dependencies = ['room'];
  assert.throws(() => parseManifest(missingDep), /cyclic/);
  const looping = structuredClone(manifest);
  looping.asset.clips.death.d00.loop = true;
  assert.throws(() => parseManifest(looping), /loop/);
});
const fixtureTexts: Record<string, string> = {};
for (const name of ['invalid-duration', 'invalid-camera', 'invalid-heading']) {
  const invalid = structuredClone(source);
  if (name === 'invalid-duration') invalid.asset.clips.walk.d45.durationsMs = [0];
  if (name === 'invalid-camera') invalid.asset.contractId = 'unapproved-other-camera';
  if (name === 'invalid-heading') delete invalid.asset.clips.walk.d225;
  fixtureTexts[name] = JSON.stringify(invalid);
}
test('compiler is byte deterministic; failed build preserves prior manifest; source confinement and case', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-compiler-'));
  try {
    const a = await compile('valid.json', dir, false, false, fixtureRoot);
    const before = await readAsset(path.join(dir, 'manifest.json'));
    const b = await compile('valid.json', dir, false, false, fixtureRoot);
    assert.equal(a.hash, b.hash);
    assert.deepEqual(await readAsset(path.join(dir, 'manifest.json')), before);
    await fs.writeFile(path.join(dir, 'invalid.json'), fixtureTexts['invalid-duration']!);
    await assert.rejects(compile('invalid.json', dir, false, false, dir));
    assert.deepEqual(await readAsset(path.join(dir, 'manifest.json')), before);
    await assert.rejects(exactSource('../package.json', fixtureRoot));
    await assert.rejects(exactSource('VALID.json', fixtureRoot), /case/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('edge RGB dilation preserves alpha and extrusion avoids black halo at silhouette', () => {
  const pixels = Buffer.from([0, 0, 0, 0, 255, 100, 30, 255, 0, 0, 0, 0]);
  const padded = paddedPixels(pixels, 3, 1);
  const index = (4 * padded.width + 4) * 4;
  assert.deepEqual([...padded.data.subarray(index, index + 4)], [255, 100, 30, 0]);
});
const clip: Clip = {
  frames: ['a', 'b', 'c'],
  durationsMs: [100, 50, 150],
  loop: true,
  notifies: [
    { id: 'step', atMs: 80, kind: 'footstep' },
    { id: 'swing', atMs: 150, kind: 'whoosh' },
  ],
};
test('notifies survive skipped frames/loops, have unique identities, interruption restarts; scrub silent; death holds', () => {
  const a = new Animator('hero', clip);
  assert.equal(a.advance(650).length, 4);
  assert.equal(a.advance(0).length, 0);
  const log = a.advance(150);
  assert.equal(log.length, 2);
  assert.equal(new Set(log.map((e) => e.key)).size, 2);
  a.seek(120);
  assert.equal(a.advance(80).length, 0);
  a.seek(1000);
  a.seek(0);
  assert.equal(a.advance(999).length, 0);
  a.start(clip);
  assert.ok(a.advance(100)[0]!.key.includes(':1:0:'));
  assert.equal(frameAt({ ...clip, loop: false }, 5000), 'c');
  const b = new Animator('other', clip);
  b.advance(180);
  assert.notEqual(a.frame, b.frame);
  assert.equal(a.time, 100);
});
test('fixed command replay matches across render cadences; catch-up bounded and pause reset discards debt', () => {
  const replay = (cadence: number) => {
    const s = new Simulation(2),
      clock = new FixedClock();
    for (let t = 0; t < 3000 - 1e-5; t += cadence)
      clock.advance(Math.min(cadence, 3000 - t), () => {
        s.step({
          move: { x: s.tick < 90 ? 1 : 0, z: 0 },
          aim: { x: 0, z: 0 },
          attack: s.tick % 40 === 0,
          ability: s.tick === 110,
          dodge: s.tick === 60,
        });
      });
    return s;
  };
  const a = replay(1000 / 30),
    b = replay(1000 / 144);
  assert.equal(a.tick, 180);
  assert.deepEqual(a, b);
  const c = new FixedClock();
  let ticks = 0;
  c.advance(20000, () => {
    ticks++;
  });
  assert.equal(ticks, 6);
  assert.ok(c.droppedMs > 19000);
  c.reset();
  approx(c.accumulator, 0);
});
test('sword hits each target once in active window; visual drawings never determine hit timing', () => {
  const s = new Simulation();
  s.actors = s.actors.slice(0, 2);
  Object.assign(s.hero, { x: 0, z: 1, px: 0, pz: 1 });
  Object.assign(s.actors[1]!, { x: 0, z: 0, px: 0, pz: 0 });
  const target = s.actors[1]!;
  for (let i = 0; i < 40; i++)
    s.step({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, attack: i === 0 });
  assert.equal(target.health, target.definition.maxHealth - tuning.attack.damage);
  assert.equal(s.hero.hitIds.length, 1);
  assert.equal(s.hero.state, 'attack');
});
test('dodge windows, ability cooldown, death interruption and action restart', () => {
  const s = new Simulation();
  s.step({ move: { x: 1, z: 0 }, aim: { x: 1, z: 0 }, dodge: true });
  assert.equal(s.hero.state, 'dodge');
  s.hero.age = tuning.dodge.invulnerableStart;
  const health = s.hero.health;
  s.damage(s.actors[1]!, s.hero, 20);
  assert.equal(s.hero.health, health);
  s.hero.age = tuning.dodge.invulnerableEnd;
  s.damage(s.actors[1]!, s.hero, 20);
  assert.equal(s.hero.state, 'hurt');
  s.start(s.hero, 'ability');
  s.hero.cooldown = tuning.ability.cooldown;
  const action = s.hero.action;
  s.damage(s.actors[1]!, s.hero, 1000);
  assert.equal(s.hero.state, 'death');
  s.step({ move: { x: 1, z: 1 }, aim: { x: 0, z: 0 }, attack: true });
  assert.equal(s.hero.state, 'death');
  assert.ok(s.hero.action > action);
  const alive = new Simulation();
  alive.step({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, ability: true });
  assert.equal(alive.hero.cooldown, 180);
  for (let i = 0; i < 100; i++)
    alive.step({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, ability: true });
  assert.ok(alive.hero.cooldown > 0);
  assert.notEqual(alive.hero.state, 'ability');
});
test('shared async resources deduplicate, cancellation cannot resurrect discarded room, retries and settled lifetime', async () => {
  let finish!: (v: { id: number }) => void,
    loads = 0,
    disposed = 0;
  const pool = new ResourcePool(
    async () => {
      loads++;
      return new Promise<{ id: number }>((r) => (finish = r));
    },
    () => disposed++,
  );
  const signal = new AbortController(),
    first = pool.acquire(['hero'], signal.signal),
    second = pool.acquire(['hero']);
  signal.abort();
  finish({ id: 1 });
  await assert.rejects(first, /cancelled/);
  const current = await second;
  assert.equal(loads, 1);
  assert.equal(disposed, 0);
  current.release();
  current.release();
  assert.equal(disposed, 1);
  assert.equal(pool.entries.size, 0);
  const stale = pool.acquire(['hero'], signal.signal);
  await assert.rejects(stale, /cancelled/);
  assert.equal(loads, 1);
  const cancelled = new AbortController(),
    pending = pool.acquire(['hero'], cancelled.signal);
  cancelled.abort();
  finish({ id: 2 });
  await assert.rejects(pending);
  assert.equal(disposed, 2);
  let fail = true;
  const retry = new ResourcePool(
    async () => {
      if (fail) throw new Error('missing');
      return { id: 3 };
    },
    () => {},
  );
  await assert.rejects(retry.acquire(['x']));
  fail = false;
  const recovered = await retry.acquire(['x']);
  recovered.release();
  assert.equal(retry.entries.size, 0);
  for (let i = 0; i < 10; i++) {
    const lease = await retry.acquire(['shared']);
    lease.release();
  }
  assert.equal(retry.entries.size, 0);
});
test('save migration, newer format rejection, serialized writes, corruption recovery and no automatic overwrite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-save-'));
  const store = new Store(dir),
    value = parseGame({ version: 0, seed: 142, wins: 1 });
  try {
    assert.equal((await store.load('game')).status, 'empty');
    await Promise.all([store.save('game', value), store.save('game', { ...value, wins: 2 })]);
    const loaded = await store.load('game');
    assert.ok('data' in loaded);
    assert.equal((loaded.data as typeof value).wins, 2);
    await fs.writeFile(path.join(dir, 'game.json'), 'corrupt');
    assert.equal((await store.load('game')).status, 'recovered');
    await store.save('game', { ...value, wins: 3 });
    assert.equal(await readAsset(path.join(dir, 'game.corrupt'), 'utf8'), 'corrupt');
    await fs.writeFile(path.join(dir, 'game.json'), 'new unreadable');
    await fs.writeFile(path.join(dir, 'game.bak'), 'also unreadable');
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', value));
    assert.equal(await readAsset(path.join(dir, 'game.json'), 'utf8'), 'new unreadable');
    assert.throws(() => parseGame({ ...value, version: 99 }));
    assert.throws(() => validateRequest('game', { ...value, extra: 'x'.repeat(20000) }));
    await fs.rm(path.join(dir, 'game.bak'));
    await assert.rejects(store.save('game', value));
    assert.equal(await readAsset(path.join(dir, 'game.json'), 'utf8'), 'new unreadable');
    await fs.writeFile(path.join(dir, 'game.bak'), JSON.stringify(value));
    await fs.writeFile(path.join(dir, 'game.json'), JSON.stringify({ ...value, version: 99 }));
    assert.equal((await store.load('game')).status, 'unreadable');
    await assert.rejects(store.save('game', value), /Newer/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('IPC sender checks and protocol constrain origin, frame, slot, payload, extensions and traversal', () => {
  assert.equal(trustedSender('lantern://app/index.html', true, 1, 1), true);
  assert.equal(trustedSender('https://evil.test', true, 1, 1), false);
  assert.equal(trustedSender('lantern://app/index.html', false, 1, 1), false);
  assert.equal(resourcePath('lantern://app/index.html', '/app/dist'), '/app/dist/index.html');
  for (const url of [
    'lantern://other/index.html',
    'lantern://app/%2e%2e%2fsecret.json',
    'lantern://app/package.exe',
    'lantern://app/%5csecret.json',
  ])
    assert.throws(() => resourcePath(url, '/app/dist'));
  assert.throws(() =>
    validateRequest('settings', { version: 1, renderScale: 3, showDebug: false }),
  );
});
function duel() {
  const s = new Simulation();
  s.actors = s.actors.slice(0, 2);
  Object.assign(s.hero, { x: 0, z: 1, px: 0, pz: 1 });
  Object.assign(s.actors[1]!, { x: 0, z: 0, px: 0, pz: 0, health: 100, stun: 10000 });
  return s;
}
const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } };
test('LMB alternates complete sweep and lunge; late clicks queue without combo links', () => {
  const s = duel(),
    attacks: string[] = [];
  let action = -1;
  for (let i = 0; i < 210; i++) {
    s.step({ ...still, attack: [0, 68, 121].includes(i) });
    if (s.hero.state === 'attack' && s.hero.action !== action) {
      action = s.hero.action;
      attacks.push(s.hero.attackKind);
    }
  }
  assert.deepEqual(attacks, ['sweep', 'lunge', 'sweep']);
  assert.equal(s.actors[1]!.health, 22);
  const early = duel();
  for (let i = 0; i < 100; i++) early.step({ ...still, attack: i === 0 || i === 2 });
  assert.equal(early.hero.attackKind, 'sweep');
  early.step({ ...still, attack: true });
  assert.equal(early.hero.attackKind, 'lunge');
});
test('dodge waits for complete attacks and travels only during authored cels', () => {
  const s = duel();
  s.startSword(s.hero, 'sweep');
  s.hero.age = attackDefinition(s.hero).total - 3;
  s.step({ ...still, move: { x: 1, z: 0 }, dodge: true });
  assert.equal(s.hero.state, 'attack');
  const d = duel();
  const start = d.hero.x;
  d.step({ ...still, move: { x: 1, z: 0 }, dodge: true });
  for (let i = 1; i < tuning.dodge.total; i++) d.step(still);
  approx(d.hero.x - start, 2.1);
  assert.equal(d.hero.nextAttack, 'sweep');
});
test('flare tests the aimed cone boundary, range, one damage/stagger per cast and cooldown', () => {
  for (const [angle, range, hit] of [
    [0, 2.5, true],
    [tuning.ability.halfAngle, 2.5, true],
    [tuning.ability.halfAngle + 0.001, 2.5, false],
    [0, 3.01, false],
  ] as const) {
    const s = duel();
    Object.assign(s.hero, { x: 0, z: 0 });
    const target = s.actors[1]!;
    Object.assign(target, { x: Math.sin(angle) * range, z: Math.cos(angle) * range, health: 70 });
    let flares = 0;
    for (let i = 0; i < 50; i++) {
      s.step({ move: { x: 0, z: 0 }, aim: { x: 0, z: 5 }, ability: true });
      flares += s.events.filter((e) => e.kind === 'flare').length;
    }
    assert.equal(flares, 1);
    assert.equal(target.health, hit ? 70 - tuning.ability.damage : 70);
    assert.equal(s.hero.hitIds.length, hit ? 1 : 0);
    assert.ok(s.hero.cooldown > 0);
  }
});
test('death resets current area exactly once, clears transient state, and invalidates old events/commands/actor references', () => {
  const session = new GameSession(content, 142, 'upper-landing'),
    old = session.sim,
    oldHero = old.hero,
    oldEnemy = old.enemies[0]!,
    generation = old.generation;
  old.hero.cooldown = 100;
  old.hero.attackBufferedUntil = 1000;
  old.damage(oldEnemy, oldHero, 1000);
  const event = old.events.at(-1)!;
  for (let i = 0; i < tuning.deathHoldTicks + 1; i++) session.step(still);
  const s = session.sim;
  assert.equal(session.resetCount, 1);
  assert.equal(s.area, 'upper-landing');
  assert.equal(s.hero.health, 100);
  assert.equal(s.hero.cooldown, 0);
  assert.equal(s.hero.attackBufferedUntil, -1);
  assert.equal(s.accepts(event), false);
  s.damage(oldEnemy, s.hero, 1000, generation);
  assert.equal(s.hero.health, 100);
  session.step({ ...still, attack: true, dodge: true, generation });
  assert.equal(s.hero.state, 'idle');
  assert.equal(session.resetCount, 1);
});
test('linked areas preserve health, establish new generations and share a continuous shallow height query', () => {
  const session = new GameSession();
  let s = session.sim;
  s.hero.health = 55;
  Object.assign(s.hero, { x: 0, z: -5.95 });
  s.enemies.forEach((a) => (a.health = 0));
  const result = session.step(still);
  assert.equal(result.transition, 'landing');
  session.commitTransition(session.prepareTransition(result.transition!));
  s = session.sim;
  assert.equal(s.area, 'upper-landing');
  assert.equal(s.hero.health, 55);
  assert.equal(session.wins, 1);
  assert.equal(s.hero.z, 7.5);
  for (const z of [1, 0, -0.5, -1, -2, -3]) {
    s.hero.z = z;
    s.move(s.hero, 0, 0);
    approx(s.hero.y, heightAt(s.areaDefinition, s.hero.x, z));
  }
  approx(heightAt(s.areaDefinition, 0, 3.75), 0.3);
  approx(heightAt(s.areaDefinition, 0, -3), 0.3);
  s.hero.z = 8.3;
  s.enemies.forEach((a) => (a.health = 0));
  session.step(still);
  session.commitTransition(session.prepareTransition('court'));
  assert.equal(session.sim.area, 'court');
  assert.equal(session.wins, 2);
  assert.equal(session.sim.hero.z, -5.5);
  assert.ok(session.sim.cleared);
});
test('aim unprojects the same raised surface used by movement and rendering; closer default framing gives a 235.2 px ruler', () => {
  const c = makeCamera(16 / 9),
    rect = { left: 80, top: 76, width: 2560, height: 1440 };
  for (const z of [-4, -1, 2]) {
    const p = new Vector3(1, heightAt(content.area('upper-landing'), 1, z), z),
      ndc = p.clone().project(c),
      q = walkablePoint(
        c,
        rect.left + ((ndc.x + 1) * rect.width) / 2,
        rect.top + ((1 - ndc.y) * rect.height) / 2,
        rect,
        content.area('upper-landing'),
      )!;
    approx(q.x, p.x);
    approx(q.y, p.y);
    approx(q.z, p.z);
  }
  assert.equal(walkablePoint(c, 0, 0, { ...rect, width: 0 }, content.area('upper-landing')), null);
  const base = new Vector3().project(c),
    top = new Vector3(0, 1.8, 0).project(c);
  assert.ok(Math.abs(((top.y - base.y) * 1440) / 2 - 235.2) < 0.05);
});
test('time zero emits once per entry; old loop closes before new loop; seek/resume cannot replay it', () => {
  const c: Clip = {
      frames: ['a', 'b'],
      durationsMs: [100, 100],
      loop: true,
      notifies: [
        { id: 'birth', atMs: 0, kind: 'dust' },
        { id: 'last', atMs: 199, kind: 'footstep' },
      ],
    },
    a = new Animator('actor', c);
  assert.equal(a.advance(0).length, 1);
  assert.equal(a.advance(0).length, 0);
  const crossed = a.advance(200);
  assert.equal(crossed.length, 2);
  assert.ok(crossed[0]!.key.includes(':0:last'));
  assert.ok(crossed[1]!.key.includes(':1:birth'));
  a.seek(0);
  assert.equal(a.advance(200).length, 0);
  a.start(c);
  assert.equal(a.advance(0).length, 1);
});
test('save v1 and settings v1 migrate without losing the checkpoint or render settings', () => {
  const current = parseGame({ version: 0, seed: 142, wins: 4 }),
    old = {
      version: 1,
      seed: current.seed,
      wins: current.wins,
      hero: { x: current.player.x, z: current.player.z, health: current.player.health },
      enemies: [-2.5, 0.2, 2.9].map((x) => ({ x, z: -3.5, health: 70 })),
    },
    migrated = parseGame(old);
  assert.equal(migrated.version, 6);
  assert.equal(migrated.area, 'court');
  assert.deepEqual(migrated.player, current.player);
  assert.equal(migrated.wins, 4);
  assert.deepEqual(parseSettings({ version: 1, renderScale: 0.75, showDebug: true }), {
    version: 5,
    verticalSpan: 9,
    renderScale: 0.75,
    showDebug: true,
    depthOfField: 1,
    visualEffects: defaultVisualEffects(),
  });
  assert.throws(() =>
    parseSettings({ version: 2, verticalSpan: 20, renderScale: 1, showDebug: false }),
  );
});
test('compiler rejects an opaque RGB concept input and keeps its prior published manifest', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-alpha-'));
  const bad = structuredClone(source),
    file = path.join(dir, 'no-alpha.png'),
    input = path.join(dir, 'invalid-alpha.json');
  try {
    await compile('valid.json', dir, false, false, fixtureRoot);
    const before = await readAsset(path.join(dir, 'manifest.json'));
    await sharp(path.join(fixtureRoot, bad.frames[0].path))
      .flatten({ background: '#ffffff' })
      .png()
      .toFile(file);
    bad.frames[0].path = 'no-alpha.png';
    await fs.writeFile(input, JSON.stringify(bad));
    await assert.rejects(compile('invalid-alpha.json', dir, false, false, dir), /alpha/);
    assert.deepEqual(await readAsset(path.join(dir, 'manifest.json')), before);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(file, { force: true });
    await fs.rm(input, { force: true });
  }
});
