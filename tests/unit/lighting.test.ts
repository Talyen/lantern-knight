import { onExit } from '../../tools/scope-exit';
import { validateLightingBindings } from '../../tools/lighting-bindings';
import { manifestFixture } from '../fixtures/manifest';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalPixels,
  defaultLook,
  cameraKeyDirection,
  lightingRigs,
} from '../../src/presentation/lighting-profiles';
import { IllustratedLighting } from '../../src/presentation/illustrated-lighting';

import { GroundMist } from '../../src/presentation/ground-mist';
import { heightAt } from '../../src/content/world';
import { content } from '../fixtures/content';
import { ActorSprite } from '../../src/presentation/sprite';
import { heroLanternPosition, heroSwordPosition } from '../../src/presentation/hero-lantern';
import { makeCamera, right, up } from '../../src/presentation/camera';
import { cameraContract as contract } from '../../src/assets/camera-contract';
import { Vector3, Texture } from 'three';
import { mockGlobals } from '../fixtures/globals';
import { NormalLibrary } from '../../src/presentation/normal-library';
import { createHash } from 'node:crypto';

test('authored sun is fixed as the view moves and removing it restores the rig', () => {
  const lighting = new IllustratedLighting();
  lighting.configure(defaultLook, new Vector3());
  assert.deepEqual(lighting.common.inkDirection.value.toArray(), cameraKeyDirection(20, 15, 0));
  const settings = { ...defaultLook, sun: { azimuthDeg: 90, elevationDeg: 35 } };
  lighting.configure(settings, new Vector3());
  const direction = lighting.common.inkDirection.value.clone();
  lighting.configure(settings, new Vector3(10, 0, -20));
  assert.deepEqual(lighting.common.inkDirection.value, direction);
  assert.deepEqual(direction.toArray(), cameraKeyDirection(90, 35, 0));
  lighting.configure({ ...defaultLook, sun: undefined }, new Vector3());
  const rig = lightingRigs[defaultLook.rig];
  assert.deepEqual(
    lighting.common.inkDirection.value.toArray(),
    cameraKeyDirection(contract.azimuthDeg, rig.elevation, rig.side),
  );
  lighting.dispose();
});

test('lantern light follows displayed socket registration, stabilization and mirrored animation', () => {
  const manifest = manifestFixture();
  manifest.asset.contentVersion = 'hero-directed-20261007-v03';
  const frame = manifest.frames[0]!;
  frame.attachments.lantern = [manifest.asset.anchor[0] + 20, manifest.asset.anchor[1] - 40];
  frame.visualOffsetPx = [10, -5];
  const texture = new Texture(),
    sprite = new ActorSprite('hero', manifest, new Map([[frame.page, texture]]), {
      frames: [frame.id],
      durationsMs: [100],
      loop: true,
      notifies: [],
    }),
    camera = makeCamera(1),
    foot = new Vector3(3, 0, 4),
    position = new Vector3();
  using _scopeExit2 = onExit(() => {
    sprite.dispose();
    texture.dispose();
  });
  sprite.show(frame.id, foot, camera);
  assert.equal(heroLanternPosition(sprite, position), true);
  const displacement = position.clone().sub(foot);
  assert.ok(Math.abs(displacement.dot(right) - 30 / manifest.asset.density) < 1e-10);
  assert.ok(Math.abs(displacement.dot(up) - 45 / manifest.asset.density) < 1e-10);
  sprite.mesh.scale.x = -1;
  heroLanternPosition(sprite, position);
  assert.ok(Math.abs(position.clone().sub(foot).dot(right) + 30 / manifest.asset.density) < 1e-10);
  sprite.stabilized = false;
  sprite.show(frame.id, foot, camera);
  heroLanternPosition(sprite, position);
  assert.ok(Math.abs(position.clone().sub(foot).dot(up) - 40 / manifest.asset.density) < 1e-10);
  // Registration-only scale calibration must carry the native socket with the body.
  sprite.mesh.scale.x = 1;
  frame.registration = { ...manifest.asset, density: manifest.asset.density / 1.16 };
  sprite.stabilized = true;
  sprite.show(frame.id, foot, camera);
  assert.equal(heroLanternPosition(sprite, position), true);
  assert.ok(
    Math.abs(position.clone().sub(foot).dot(right) - (30 * 1.16) / manifest.asset.density) < 1e-10,
  );
  assert.ok(
    Math.abs(position.clone().sub(foot).dot(up) - (45 * 1.16) / manifest.asset.density) < 1e-10,
  );
  assert.deepEqual(sprite.mesh.position, foot);
  manifest.asset.contentVersion = 'different-drawings';
  assert.equal(heroLanternPosition(sprite, position), false);
});

test('Lunge effect sockets follow enlarged and mirrored native blade drawings', () => {
  const manifest = manifestFixture();
  manifest.asset.contentVersion = 'hero-directed-20261007-v03';
  const frame = manifest.frames[0]!;
  frame.id = 'lunge-d90-00';
  frame.visualOffsetPx = [10, -5];
  const texture = new Texture();
  const sprite = new ActorSprite('hero', manifest, new Map([[frame.page, texture]]), {
    frames: [frame.id],
    durationsMs: [100],
    loop: false,
    notifies: [],
  });
  const base = new Vector3(),
    tip = new Vector3(),
    foot = new Vector3(3, 0, 4);
  using _scopeExit1 = onExit(() => {
    sprite.dispose();
    texture.dispose();
  });
  sprite.mesh.scale.setScalar(1.1);
  sprite.show(frame.id, foot, makeCamera(1));
  assert.equal(heroSwordPosition(sprite, base, tip), true);
  const blade = tip.clone().sub(base);
  assert.ok(Math.abs(blade.dot(right) - ((294 - 218) / manifest.asset.density) * 1.1) < 1e-10);
  assert.ok(Math.abs(blade.dot(up) - ((310 - 459) / manifest.asset.density) * 1.1) < 1e-10);
  sprite.mesh.scale.x = -1.1;
  heroSwordPosition(sprite, base, tip);
  assert.ok(
    Math.abs(tip.clone().sub(base).dot(right) + ((294 - 218) / manifest.asset.density) * 1.1) <
      1e-10,
  );
  manifest.asset.contentVersion = 'different-drawings';
  assert.equal(heroSwordPosition(sprite, base, tip), false);
});

test('mist ribbons follow the raised terrain rather than intersecting its steps', () => {
  const mist = new GroundMist(),
    area = content.area('upper-landing');
  mist.setArea(area);
  for (const object of mist.group.children) {
    const mesh = object as import('three').Mesh,
      vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++)
      assert.ok(
        Math.abs(
          vertices.getY(i) -
            heightAt(area, mesh.position.x + vertices.getX(i), mesh.position.z + vertices.getZ(i)) -
            0.14,
        ) < 1e-6,
      );
  }
  mist.dispose();
  assert.equal(mist.group.parent, null);
});
test('alpha-derived normals point outward with an unchanged coverage channel', () => {
  const alpha = new Uint8Array([
      0, 0, 0, 0, 0, 0, 40, 100, 40, 0, 0, 100, 255, 100, 0, 0, 40, 100, 40, 0, 0, 0, 0, 0, 0,
    ]),
    normals = normalPixels(alpha, 5, 5, 2);
  const pixel = (x: number, y: number) => normals.slice((y * 5 + x) * 4, (y * 5 + x) * 4 + 4);
  assert.ok(pixel(1, 2)[0]! < 128);
  assert.ok(pixel(3, 2)[0]! > 128);
  assert.ok(pixel(2, 1)[1]! > 128);
  assert.ok(pixel(2, 3)[1]! < 128);
  assert.deepEqual([...pixel(2, 2)], [128, 128, 255, 255]);
  for (let i = 0; i < alpha.length; i++) assert.equal(normals[i * 4 + 3], alpha[i]);
  assert.throws(() => normalPixels(alpha, 4, 5), /dimensions/);
  const manifest = manifestFixture(),
    frame = manifest.frames[0]!;
  const entry = {
    file: 'normal.png',
    hash: 'c'.repeat(64),
    sourceHash: manifest.pages[0]!.hash,
    rect: frame.rect,
    trim: frame.trim,
  };
  const library = {
    recipe: 'alpha-volume-v1',
    entries: { 'ink-hero-current:sample-frame': entry },
  };
  const manifests = new Map([['ink-hero-current', manifest]]);
  validateLightingBindings(library, manifests);
  assert.throws(
    () => validateLightingBindings({ ...library, entries: {} }, manifests),
    /Missing lighting/,
  );
  assert.throws(
    () =>
      validateLightingBindings(
        {
          ...library,
          entries: { 'ink-hero-current:sample-frame': { ...entry, sourceHash: 'd'.repeat(64) } },
        },
        manifests,
      ),
    /Stale lighting/,
  );
  assert.throws(
    () =>
      validateLightingBindings(
        {
          ...library,
          entries: { 'ink-hero-current:sample-frame': { ...entry, rect: [1, 1, 1, 1] } },
        },
        manifests,
      ),
    /crop differs/,
  );
  assert.throws(
    () =>
      validateLightingBindings(
        { ...library, entries: { ...library.entries, 'unknown:frame': entry } },
        manifests,
      ),
    /Unknown lighting/,
  );
});

test('lighting replacement preserves the current room on failure, retries, and releases late or removed companions', async () => {
  const { createHash } = await import('node:crypto'),
    bytes = Buffer.from('verified companion'),
    hash = createHash('sha256').update(bytes).digest('hex');
  const priorFetch = globalThis.fetch,
    priorBitmap = globalThis.createImageBitmap;
  const requests: string[] = [];
  let closed = 0,
    fail = '',
    wait: Promise<Response> | undefined,
    requested: (() => void) | undefined;
  const entry = (file: string) => ({
    file,
    hash,
    width: 2,
    height: 2,
    sourceHash: 'a'.repeat(64),
    rect: [0, 0, 2, 2],
    trim: [0, 0, 2, 2],
  });
  globalThis.fetch = (async (url) => {
    requests.push(url instanceof Request ? url.url : url.toString());
    const file = url instanceof Request ? url.url : url.toString();
    if (file === '/lighting/' + fail) return new Response('', { status: 503 });
    if (file === '/lighting/c.png' && wait) {
      requested?.();
      return wait;
    }
    return file.endsWith('manifest.json')
      ? new Response(
          JSON.stringify({
            recipe: 'alpha-volume-v1',
            entries: {
              'ink-hero-current:pose': entry('base.png'),
              'ink-unused:pose': entry('unused.png'),
              'library-a:pose': entry('a.png'),
              'library-b:pose': entry('b.png'),
              'library-c:pose': entry('c.png'),
            },
          }),
        )
      : new Response(bytes);
  }) as typeof fetch;
  globalThis.createImageBitmap = (async () =>
    ({ width: 2, height: 2, close: () => closed++ }) as ImageBitmap) as typeof createImageBitmap;
  const library = new NormalLibrary();
  const load = (...ids: string[]) => library.load(['ink-hero-current', ...ids]);
  try {
    fail = 'manifest.json';
    await assert.rejects(load('library-a'), /companions unavailable/);
    fail = '';
    await load('library-a');
    assert.equal(requests.includes('/lighting/b.png'), false);
    assert.equal(requests.includes('/lighting/unused.png'), false);
    assert.equal(library.bytes, 32);
    await load('library-a');
    assert.equal(requests.filter((u) => u === '/lighting/a.png').length, 1);
    const current = library.textures.get('library-a:pose');
    let finish!: (response: Response) => void;
    wait = new Promise((resolve) => (finish = resolve));
    const started = new Promise<void>((resolve) => (requested = resolve));
    fail = 'b.png';
    const replacement = load('library-b', 'library-c');
    let settled = false;
    const rejected = assert.rejects(replacement, /HTTP 503/).then(() => {
      settled = true;
    });
    await started;
    assert.equal(settled, false, 'Failed batches must settle and release successful late peers');
    assert.equal(library.textures.get('library-a:pose'), current);
    finish(new Response(bytes));
    await rejected;
    assert.equal(closed, 1);
    assert.equal(library.textures.get('library-a:pose'), current);
    assert.equal(library.bytes, 32);
    assert.equal(library.textures.has('library-c:pose'), false);
    fail = '';
    await load('library-b');
    assert.equal(closed, 2);
    assert.equal(library.bytes, 32);
    assert.equal(library.textures.has('library-a:pose'), false);

    wait = new Promise((resolve) => (finish = resolve));
    const lateStarted = new Promise<void>((resolve) => (requested = resolve));
    const late = load('library-c');
    await lateStarted;
    library.dispose();
    finish(new Response(bytes));
    await assert.rejects(late, /aborted/);
    assert.equal(library.textures.size, 0);
    assert.equal(library.bytes, 0);
  } finally {
    library.dispose();
    globalThis.fetch = priorFetch;
    globalThis.createImageBitmap = priorBitmap;
  }
  assert.equal(closed, 4, 'Cancellation before decode avoids allocating another bitmap');
});

test('companion replacement consumes removed ownership before attempting every cleanup', async (t) => {
  const bytes = Buffer.from('companion'),
    hash = createHash('sha256').update(bytes).digest('hex'),
    closed: string[] = [],
    unavailable = Promise.withResolvers<Response>();
  let decoded = 0;
  mockGlobals(t, {
    fetch: async (url: string) =>
      url.endsWith('manifest.json')
        ? new Response(
            JSON.stringify({
              recipe: 'alpha-volume-v1',
              entries: Object.fromEntries(
                ['old-a', 'old-b', 'new', 'unavailable'].map((id) => [
                  id + ':pose',
                  {
                    file: id + '.png',
                    hash,
                    width: 2,
                    height: 2,
                    sourceHash: 'a'.repeat(64),
                    rect: [0, 0, 2, 2],
                    trim: [0, 0, 2, 2],
                  },
                ]),
              ),
            }),
          )
        : url.endsWith('unavailable.png')
          ? unavailable.promise
          : new Response(bytes),
    createImageBitmap: async () => {
      const id = String(++decoded);
      if (decoded === 5) unavailable.resolve(new Response('', { status: 503 }));
      return {
        width: 2,
        height: 2,
        close: () => {
          closed.push(id);
          if (id === '4') throw new Error('Bitmap cleanup failed');
        },
      } as unknown as ImageBitmap;
    },
  });
  const library = new NormalLibrary();
  await library.load(['old-a', 'old-b']);
  const failure = new Error('GPU cleanup failed');
  library.textures.get('old-a:pose')!.addEventListener('dispose', () => {
    throw failure;
  });
  try {
    await assert.rejects(library.load(['new']), (error) => error === failure);
    assert.deepEqual([...library.textures.keys()], ['new:pose']);
    assert.deepEqual(closed, ['1', '2'], 'A failing GPU cleanup cannot strand sibling bitmaps');
    assert.equal(library.bytes, 16);
    await library.load(['new']);
    assert.equal(decoded, 3, 'The accepted selection remains usable after cleanup failure');
    await assert.rejects(library.load(['new', 'old-a', 'old-b', 'unavailable']), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(String(error.cause), /HTTP 503/);
      return true;
    });
    assert.deepEqual([...library.textures.keys()], ['new:pose']);
    assert.equal(library.bytes, 16);
    assert.deepEqual(
      closed,
      ['1', '2', '4', '5'],
      'Failed acquisitions drain all staged companions',
    );
  } finally {
    library.dispose();
  }
  assert.deepEqual(closed, ['1', '2', '4', '5', '3']);
});

test('painted shade zones round-trip through content, enforce capacity, and clear on scene replacement', async () => {
  const { emptyScene } = await import('../../src/editor/default-scene'),
    { parseSceneDocument } = await import('../../src/content/scene-document'),
    { resolveAuthoredScene } = await import('../../src/content/world-art'),
    { SCENE_SHADE_CAPACITY } = await import('../../src/content/world-visuals');
  const document = emptyScene();
  const zones = [{ x: 2, z: 3, radius: 4, strength: 0.4 }];
  document.look.shadeZones = zones;
  const roundTrip = parseSceneDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(resolveAuthoredScene(roundTrip).look?.shadeZones, zones);
  for (const invalid of [
    { ...zones[0], radius: 0 },
    { ...zones[0], strength: 1 },
    { ...zones[0], x: NaN },
  ])
    assert.throws(() =>
      parseSceneDocument({ ...document, look: { ...document.look, shadeZones: [invalid] } }),
    );
  assert.throws(() =>
    parseSceneDocument({
      ...document,
      look: {
        ...document.look,
        shadeZones: Array.from({ length: SCENE_SHADE_CAPACITY + 1 }, () => zones[0]),
      },
    }),
  );
  const lighting = new IllustratedLighting();
  using _cleanup1 = onExit(() => lighting.dispose());
  lighting.configure({ ...defaultLook, shadeZones: zones }, new Vector3());
  assert.deepEqual(lighting.common.inkShadeZones.value[0]!.toArray(), [2, 3, 4, 0.4]);
  lighting.configure(defaultLook, new Vector3());
  assert.ok(lighting.common.inkShadeZones.value.every((zone) => zone.w === 0));
});
