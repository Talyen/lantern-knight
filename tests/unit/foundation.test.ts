import { ResourcePool } from '../../src/assets/resource-pool';
import { manifestFixture } from '../fixtures/manifest';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Texture } from 'three';
import {
  makeCamera,
  constrainCamera,
  outward,
  resizeCamera,
  groundPoint,
  screenMovement,
} from '../../src/presentation/camera';
import { selectDirection } from '../../src/content/headings';
import { trimmedBounds } from '../../src/assets/sprite-registration';
import { cameraCalibration } from '../../src/assets/camera-calibration';
import { cameraContract as contract } from '../../src/assets/camera-contract';
import { Animator, frameAt, retimeClip } from '../../src/core/animation';
import { Simulation, FixedClock } from '../../src/core/simulation';
import { tuning } from '../../src/content/gameplay';
import { resolveActorClip, resolveClip, type Clip } from '../../src/assets/schema';
import { paddedPixels } from '../../tools/compiler';
import { AssetRuntime, pageIdentity } from '../../src/assets/loader';
import { StorageCodec } from '../../src/platform/storage-codec';
import { resourcePath, trustedSender } from '../../electron/security';

import { content } from '../fixtures/content';
import { boundaryContains } from '../../src/content/world';
import { GameSession } from '../../src/core/session';

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
  const fixture = cameraCalibration(contract);
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
test('invalid animation deltas and seeks leave playback and notifications usable', () => {
  const animation = new Animator('hero', clip);
  animation.advance(50);
  animation.advance(NaN);
  assert.equal(animation.time, 50);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(animation.advance(invalid), []);
    animation.seek(invalid);
    assert.equal(animation.time, 50);
  }
  assert.deepEqual(
    animation.advance(30).map((e) => e.kind),
    ['footstep'],
  );
});
test('notifies survive skipped frames/loops, have unique identities, interruption restarts; scrub silent; death holds', () => {
  const retimed = new Animator('retimed', retimeClip(clip, [50, 150, 100]));
  assert.deepEqual(
    retimed.advance(199).map((event) => [event.kind, event.timeMs]),
    [['footstep', 40]],
  );
  assert.deepEqual(
    retimed.advance(1).map((event) => [event.kind, event.timeMs]),
    [['whoosh', 200]],
  );
  assert.deepEqual(clip.durationsMs, [100, 50, 150]);
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
          actions: [
            ...(s.tick % 40 === 0 ? ['sword' as const] : []),
            ...(s.tick === 110 ? ['lantern' as const] : []),
            ...(s.tick === 60 ? ['dodge' as const] : []),
          ],
        });
      });
    return {
      tick: s.tick,
      seed: s.seed,
      hero: s.hero,
      enemies: s.enemies,
      area: s.captureAreaState(),
    };
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
  assert.equal(pool.size, 0);
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
  assert.equal(retry.size, 0);
  for (let i = 0; i < 10; i++) {
    const lease = await retry.acquire(['shared']);
    lease.release();
  }
  assert.equal(retry.size, 0);
  const firstManifest = manifestFixture('first');
  const secondManifest = structuredClone(firstManifest);
  secondManifest.asset.id = 'second';
  secondManifest.asset.anchor = [100, 200];
  let decoded = 0,
    released = 0;
  const runtime = new AssetRuntime(
    { first: 'generated/first.json', second: 'generated/second.json' },
    async (url) =>
      new Response(
        JSON.stringify(
          (url instanceof Request ? url.url : url.toString()).includes('first')
            ? firstManifest
            : secondManifest,
        ),
      ),
    async () => {
      decoded++;
      return new Texture();
    },
    () => released++,
  );
  const batchController = new AbortController(),
    batch = await runtime.loadPacks(['first', 'second', 'first'], batchController.signal);
  batchController.abort(); // Completed batches transfer ownership to their caller.
  const firstPack = batch.packs.get('first')!,
    secondPack = batch.packs.get('second')!;
  assert.equal(decoded, 1);
  assert.equal(firstPack.textures.get('atlas-0'), secondPack.textures.get('atlas-0'));
  assert.notDeepEqual(firstPack.manifest.asset.anchor, secondPack.manifest.asset.anchor);
  firstPack.release();
  firstPack.release();
  assert.equal(released, 0);
  batch.release();
  batch.release();
  assert.equal(released, 1);
  assert.equal(runtime.resourceCount, 0);
  assert.notEqual(
    pageIdentity(firstManifest.pages[0]!),
    pageIdentity({ ...firstManifest.pages[0]!, hash: 'c'.repeat(64) }),
  );
});
test('pool shutdown invalidates shared leases and disposes late results exactly once', async () => {
  const finishes = new Map<string, (value: object) => void>(),
    destroyed: object[] = [],
    pool = new ResourcePool(
      (id) => new Promise<object>((resolve) => finishes.set(id, resolve)),
      (value) => destroyed.push(value),
    );
  const liveValue = {},
    lateValue = {};
  const first = pool.acquire(['live']),
    second = pool.acquire(['live']);
  finishes.get('live')!(liveValue);
  const leases = await Promise.all([first, second]);
  const late = pool.acquire(['late']);
  pool.dispose();
  pool.dispose();
  assert.deepEqual(destroyed, [liveValue]);
  finishes.get('late')!(lateValue);
  await assert.rejects(late, /disposed/);
  for (const lease of leases) lease.release();
  assert.deepEqual(destroyed, [liveValue, lateValue]);
  assert.equal(pool.size, 0);
  await assert.rejects(pool.acquire(['live']), /disposed/);
});

test('failed pool batches drain late peers and synchronous loader failures remain retryable', async () => {
  let finish!: (value: object) => void;
  const destroyed: object[] = [],
    value = {},
    pool = new ResourcePool(
      (id) => {
        if (id === 'bad') throw new Error('decode failed');
        return new Promise<object>((resolve) => {
          finish = resolve;
        });
      },
      (value) => destroyed.push(value),
    );
  let settled = false;
  const failed = pool.acquire(['bad', 'late']).finally(() => {
    settled = true;
  });
  const rejected = assert.rejects(failed, /decode failed/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  finish(value);
  await rejected;
  assert.deepEqual(destroyed, [value]);
  assert.equal(pool.size, 0);
  const retry = pool.acquire(['late']);
  finish({});
  (await retry).release();
  assert.equal(destroyed.length, 2);
});

test('runtime shutdown closes active packs, pending manifests and decodes, and rejects reuse', async () => {
  const manifest = manifestFixture();
  let respond!: (response: Response) => void,
    finish!: (texture: Texture) => void,
    requests = 0,
    decoded = 0;
  const destroyed: Texture[] = [],
    runtime = new AssetRuntime(
      { live: 'generated/live.json', late: 'generated/late.json' },
      () => {
        requests++;
        return new Promise<Response>((resolve) => {
          respond = resolve;
        });
      },
      () => {
        decoded++;
        return new Promise<Texture>((resolve) => {
          finish = resolve;
        });
      },
      (texture) => destroyed.push(texture),
    );
  manifest.asset.id = 'live';
  runtime.seedManifest('live', manifest);
  const live = runtime.loadPack('live');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const first = new Texture();
  finish(first);
  const held = await live;
  // Use a distinct page so this acquisition is still decoding at shutdown.
  const next = structuredClone(manifest);
  next.pages[0]!.hash = 'e'.repeat(64);
  runtime.seedManifest('live', next);
  const pending = runtime.loadPack('live'),
    lateManifest = runtime.loadPack('late');
  await new Promise<void>((resolve) => setImmediate(resolve));
  runtime.dispose();
  runtime.dispose();
  assert.deepEqual(destroyed, [first]);
  const second = new Texture();
  finish(second);
  respond(new Response(JSON.stringify(manifest)));
  await assert.rejects(pending, /disposed/);
  await assert.rejects(lateManifest, /disposed/);
  held.release();
  assert.deepEqual(destroyed, [first, second]);
  assert.equal(runtime.resourceCount, 0);
  await assert.rejects(runtime.loadPack('live'), /disposed/);
  await assert.rejects(runtime.loadPacks([]), /disposed/);
  await assert.rejects(runtime.manifest('late'), /disposed/);
  assert.throws(() => runtime.seedManifest('live', manifest), /disposed/);
  assert.equal(requests, 1);
  assert.equal(decoded, 2);
});
test('IPC sender checks and protocol constrain origin, frame, slot, payload, extensions and traversal', () => {
  assert.equal(trustedSender('lantern://app/index.html', true, 1, 1), true);
  assert.equal(trustedSender('https://evil.test', true, 1, 1), false);
  assert.equal(trustedSender('lantern://app/index.html', false, 1, 1), false);
  assert.equal(resourcePath('lantern://app/index.html', '/app/dist'), '/app/dist/index.html');
  const bundle = 'runtime-assets/hero-0-' + 'a'.repeat(64) + '.bin';
  assert.equal(resourcePath('lantern://app/' + bundle, '/app/dist'), '/app/dist/' + bundle);
  assert.equal(
    resourcePath('lantern://app/media/last-ferry.mp4', '/app/dist'),
    '/app/dist/media/last-ferry.mp4',
  );
  for (const url of [
    'lantern://other/index.html',
    'lantern://app/%2e%2e%2fsecret.mp4',
    'lantern://app/%2e%2e%2fsecret.json',
    'lantern://app/package.exe',
    'lantern://app/arbitrary.bin',
    'lantern://app/runtime-assets/unverified.bin',
    'lantern://app/%2e%2e%2fruntime-assets/hero-0-' + 'a'.repeat(64) + '.bin',
    'lantern://app/%5csecret.json',
  ])
    assert.throws(() => resourcePath(url, '/app/dist'));
  assert.throws(() =>
    new StorageCodec(content).snapshot('settings', {
      version: 1,
      renderScale: 3,
      showDebug: false,
    }),
  );
});
const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } };

test('death resets current area exactly once, clears transient state, and invalidates old commands and actor references', () => {
  const session = new GameSession(content, 142, 'upper-landing'),
    old = session.sim,
    oldHero = old.hero,
    oldEnemy = old.enemies[0]!,
    generation = old.generation;
  old.hero.cooldown = 100;
  old.hero.pendingAction = { kind: 'sword', yaw: 0 };
  old.damage(oldEnemy, oldHero, 1000);
  for (let i = 0; i < tuning.deathHoldTicks + 1; i++) {
    const result = session.step(still);
    if (result.reset) {
      assert.equal(session.sim, old, 'Reset requests must leave replacement to the host');
      session.resetCurrentArea(result.reset);
    }
  }
  const s = session.sim;
  assert.equal(session.resetCount, 1);
  assert.equal(s.area, 'upper-landing');
  assert.equal(s.hero.health, 100);
  assert.equal(s.hero.cooldown, 0);
  assert.equal(s.hero.pendingAction, undefined);
  s.damage(oldEnemy, s.hero, 1000, generation);
  s.damage(oldEnemy, s.hero, 1000);
  assert.equal(s.hero.health, 100);
  const retiredHealth = oldEnemy.health;
  s.damage(s.hero, oldEnemy, 1000);
  assert.equal(oldEnemy.health, retiredHealth);
  session.step({ ...still, actions: ['sword', 'dodge'], generation });
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

test('camera framing keeps the ground viewport inside convex boundaries', () => {
  for (const boundary of [
    [
      { x: -6, z: -6 },
      { x: 6, z: -6 },
      { x: 6, z: 7 },
      { x: -6, z: 7 },
    ],
    [
      { x: -6, z: -6 },
      { x: 6, z: -6 },
      { x: 0, z: 7 },
    ],
    [
      { x: -6, z: -6 },
      { x: 6, z: -6 },
      { x: 2, z: 7 },
      { x: -2, z: 7 },
    ],
  ]) {
    const area = { ...content.area('court'), playableBoundary: boundary };
    for (const desired of [new Vector3(0, 0, 0), new Vector3(5, 0, 6)]) {
      const camera = makeCamera(16 / 9),
        target = desired.clone();
      constrainCamera(camera, target, area);
      camera.position.copy(target).addScaledVector(outward, 30);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      for (const x of [0, 800])
        for (const y of [0, 450]) {
          const point = groundPoint(camera, x, y, { left: 0, top: 0, width: 800, height: 450 })!;
          // The camera constrains the rendered floor, 1 cm below gameplay.
          point.addScaledVector(outward, -0.01 / outward.y);
          assert.ok(
            boundaryContains(boundary, point),
            `viewport outside boundary: ${point.toArray().join(', ')}`,
          );
        }
    }
  }
});

test('an impossible focus cannot reveal space outside a scene', () => {
  const area = content.area('court'),
    position = new Vector3(-100, 8, -100),
    target = position.clone(),
    camera = makeCamera(16 / 9);
  constrainCamera(camera, target, area, {
    position,
    height: contract.heroHeight * tuning.heroVisualScale,
  });
  camera.position.copy(target).addScaledVector(outward, 30);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  for (const x of [0, 800])
    for (const y of [0, 450]) {
      const point = groundPoint(camera, x, y, { left: 0, top: 0, width: 800, height: 450 })!;
      point.addScaledVector(outward, -0.01 / outward.y);
      assert.ok(point.x >= area.bounds.minX - 1e-8 && point.x <= area.bounds.maxX + 1e-8);
      assert.ok(point.z >= area.bounds.minZ - 1e-8 && point.z <= area.bounds.maxZ + 1e-8);
    }
});

test('supplied actor kits select delivered facings while authored clips stay strict', () => {
  const manifest = manifestFixture();
  manifest.asset.viewMode = 'supplied';
  const first = Object.values(manifest.asset.clips)[0]!,
    clip = Object.values(first)[0]!;
  manifest.asset.clips.move = {
    d00: structuredClone(clip),
    d90: structuredClone(clip),
    d180: structuredClone(clip),
    d270: structuredClone(clip),
  };
  manifest.asset.clips.hit = { d90: structuredClone(clip) };
  assert.equal(resolveActorClip(manifest, 'move', 'd270'), manifest.asset.clips.move.d270);
  assert.equal(resolveActorClip(manifest, 'move', 'd315'), manifest.asset.clips.move.d00);
  assert.equal(resolveActorClip(manifest, 'move', 'd135'), manifest.asset.clips.move.d90);
  assert.equal(resolveActorClip(manifest, 'hit', 'd270'), manifest.asset.clips.hit.d90);
  assert.throws(() => resolveActorClip(manifest, 'missing', 'd45'), /required clip unavailable/);
  assert.throws(() => resolveClip(manifest, 'hit', 'd270'), /required clip unavailable/);
  manifest.asset.viewMode = 'directional';
  assert.throws(() => resolveActorClip(manifest, 'hit', 'd270'), /required clip unavailable/);
});
