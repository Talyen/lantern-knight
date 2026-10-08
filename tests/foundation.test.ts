import { manifestFixture } from './fixtures/manifest';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Texture } from 'three';
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
import { type Clip } from '../src/assets/schema';
import { paddedPixels } from '../tools/compiler';
import { ResourcePool, AssetRuntime, pageIdentity } from '../src/assets/loader';
import { validateRequest } from '../electron/store';
import { resourcePath, trustedSender } from '../electron/security';

import { content } from '../src/content/game-content';
import { GameSession } from '../src/core/session';

const approx = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
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
  const unsorted: Clip = {
    ...clip,
    notifies: [
      { id: 'later', atMs: 150, kind: 'whoosh' },
      { id: 'earlier', atMs: 50, kind: 'dust' },
      { id: 'together', atMs: 150, kind: 'flash' },
    ],
  };
  const notifications = new Animator('ordered', unsorted);
  assert.deepEqual(
    notifications.advance(200).map((n) => n.kind),
    ['dust', 'whoosh', 'flash'],
  );
  notifications.start(unsorted);
  assert.deepEqual(
    notifications.advance(200).map((n) => n.kind),
    ['dust', 'whoosh', 'flash'],
  );
  assert.deepEqual(
    unsorted.notifies.map((n) => n.id),
    ['later', 'earlier', 'together'],
  );
});
test('fixed command replay matches across render cadences; catch-up bounded and pause reset discards debt', () => {
  const replay = (cadence: number) => {
    const s = new Simulation(content, 2, content.definitions.initialArea, 1),
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
  const firstManifest = manifestFixture();
  const secondManifest = structuredClone(firstManifest);
  secondManifest.asset.id = 'second-registration';
  secondManifest.asset.anchor = [100, 200];
  let decoded = 0,
    released = 0;
  const runtime = new AssetRuntime(
    { first: 'generated/first.json', second: 'generated/second.json' },
    false,
    async (url) =>
      new Response(JSON.stringify(String(url).includes('first') ? firstManifest : secondManifest)),
    async () => {
      decoded++;
      return new Texture();
    },
    () => released++,
  );
  const [firstPack, secondPack] = await Promise.all([
    runtime.loadPack('first'),
    runtime.loadPack('second'),
  ]);
  assert.equal(decoded, 1);
  assert.equal(firstPack.textures.get('atlas-0'), secondPack.textures.get('atlas-0'));
  assert.notDeepEqual(firstPack.manifest.asset.anchor, secondPack.manifest.asset.anchor);
  firstPack.release();
  firstPack.release();
  assert.equal(released, 0);
  secondPack.release();
  assert.equal(released, 1);
  assert.equal(runtime.pool.entries.size, 0);
  assert.notEqual(
    pageIdentity(firstManifest.pages[0]!),
    pageIdentity({ ...firstManifest.pages[0]!, hash: 'c'.repeat(64) }),
  );
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
  const s = new Simulation(content, 142, content.definitions.initialArea, 1);
  s.actors = s.actors.slice(0, 2);
  Object.assign(s.hero, { x: 0, z: 1, px: 0, pz: 1 });
  Object.assign(s.actors[1]!, { x: 0, z: 0, px: 0, pz: 0, health: 100, stun: 10000 });
  return s;
}
const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } };

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
