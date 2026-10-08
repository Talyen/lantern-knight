import { assetFile } from '../tools/assets/paths';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultVisualEffects,
  dryWeather,
  normalizeWeather,
  lightFlicker,
} from '../src/content/visual-effects';
import {
  rainEvent,
  RainSchedule,
  sheltered,
  rainPathSheltered,
  RAIN_FALL,
  RAIN_SLOTS,
} from '../src/presentation/rain-events';
import { inPuddle } from '../src/presentation/playground-surfaces';
import { FoliageWind } from '../src/presentation/foliage-wind';
import { ActorSprite } from '../src/presentation/sprite';
import { SurfaceRelief } from '../src/presentation/surface-relief';
import { IllustratedLighting } from '../src/presentation/illustrated-lighting';
import { graveyardGroundMaterial } from '../src/presentation/graveyard-ground';
import { assetCatalog } from '../src/content/asset-catalog';
import { worldVisuals } from '../src/content/world-art';
import type { PackLease } from '../src/assets/loader';
import { ShaderLib, MeshDepthMaterial, MeshBasicMaterial, Texture, WebGLRenderer } from 'three';
import fs from 'node:fs';
import type { Manifest } from '../src/assets/schema';

test('the production graveyard shader uses its authored surface companion without loading obsolete surfaces', async () => {
  const request = globalThis.fetch,
    decode = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'),
    surfaces = new SurfaceRelief(),
    lighting = new IllustratedLighting();
  const packs = new Map<string, PackLease>(
    ['ink-graveyard-materials', 'ink-soil', 'ink-graveyard-overlays'].map((id) => {
      const manifest = JSON.parse(
        fs.readFileSync(assetFile('public/' + assetCatalog[id]), 'utf8'),
      ) as Manifest;
      return [
        id,
        {
          manifest,
          textures: new Map(manifest.pages.map((page) => [page.id, new Texture()])),
          release() {},
        },
      ];
    }),
  );
  const manifest = packs.get('ink-graveyard-materials')!.manifest,
    frame = manifest.frames.find((f) => f.id === 'apron')!,
    page = manifest.pages.find((p) => p.id === frame.page)!;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('.json'))
      return new Response(
        JSON.stringify({
          recipe: 'hand-authored-stone-height-v1',
          entries: {
            apron: {
              asset: 'ink-graveyard-materials',
              frame: 'apron',
              pageHash: page.hash,
              file: 'apron.png',
              width: 1,
              height: 1,
              hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
            },
            crypt: { file: 'obsolete.png' },
            paving: { file: 'obsolete.png' },
          },
        }),
      );
    assert.equal(
      String(url),
      '/visual-effects/apron.png',
      'Unused companions must not block the current scene',
    );
    return new Response('abc');
  };
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 1, height: 1, close() {} }),
  });
  let material: MeshBasicMaterial | undefined;
  try {
    await surfaces.load(packs);
    material = graveyardGroundMaterial(packs, worldVisuals.court!);
    lighting.attach(material, true);
    surfaces.attach(material);
    const program = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    material.onBeforeCompile(program as never, {} as WebGLRenderer);
    const weight = program.fragmentShader.match(/fxSurfaceWeight=(?!0\.)[^;]+;/)?.[0];
    assert.ok(weight, 'Ground normals must not be multiplied by an unchanged zero weight');
    assert.ok(
      program.fragmentShader.indexOf(weight) <
        program.fragmentShader.indexOf('outgoingLight=inkIlluminate'),
    );
    surfaces.update(defaultVisualEffects());
    assert.equal(program.uniforms.surfaceNormals!.value, 1);
    surfaces.update({ ...defaultVisualEffects(), surfaceDepth: false });
    assert.equal(program.uniforms.surfaceNormals!.value, 0);
    assert.equal(program.uniforms.surfaceRelief!.value, 1);
  } finally {
    material?.dispose();
    surfaces.dispose();
    lighting.dispose();
    for (const pack of packs.values())
      for (const texture of pack.textures.values()) texture.dispose();
    globalThis.fetch = request;
    if (decode) Object.defineProperty(globalThis, 'createImageBitmap', decode);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  }
});
test('a seeded drop owns an invariant endpoint and triggers its splash at impact', () => {
  assert.equal(dryWeather().rain, 0);
  assert.deepEqual(normalizeWeather({ rain: NaN, wind: { x: Infinity, z: 4 } }), {
    rain: 0,
    wind: { x: 0, z: 3 },
  });

  const bounds = { minX: -5, maxX: 5, minZ: -4, maxZ: 4 },
    weather = { rain: 1, wind: { x: 1, z: -0.5 } };
  for (let slot = 0; slot < RAIN_SLOTS; slot++) {
    const initial = rainEvent(4, slot, 903, bounds, weather),
      impact = initial.impactTime,
      before = rainEvent(impact - 0.0001, slot, 903, bounds, weather),
      after = rainEvent(impact + 0.0001, slot, 903, bounds, weather);
    assert.equal(before.splashAge < 0, true);
    assert.equal(after.splashAge >= 0, true);
    assert.equal(after.x, before.x);
    assert.equal(after.z, before.z);
    assert.ok(Math.abs(after.age - RAIN_FALL) < 0.001);
    assert.equal(after.startX, after.x - weather.wind.x * RAIN_FALL - 0.16);
    assert.deepEqual(after, rainEvent(impact + 0.0001, slot, 903, bounds, weather));
    assert.equal(rainEvent(impact, slot, 903, bounds, dryWeather()).active, false);
  }
  const roof = [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }];
  assert.equal(sheltered(0, 0, roof), true);
  assert.equal(sheltered(2, 0, roof), false);
  assert.equal(rainPathSheltered(-2, 0, 2, 0, roof), true);
  assert.equal(rainPathSheltered(-2, 2, 2, 2, roof), false);
  assert.equal(inPuddle(1.5, 1.6), true);
  assert.equal(inPuddle(-3.5, -1), false);
  const schedule = new RainSchedule(903),
    start = { ...schedule.sample(0.1, 0, bounds, weather) },
    gust = schedule.sample(0.4, 0, bounds, { rain: 0.6, wind: { x: -2, z: 2 } });
  assert.equal(gust.startX, start.startX);
  assert.equal(gust.startZ, start.startZ);
  assert.equal(gust.x, start.x);
  assert.equal(gust.age, 0.4);
  assert.equal(gust.impactTime, start.impactTime);
  const later = schedule.sample(3.1, 0, bounds, { rain: 1, wind: { x: -2, z: 2 } });
  assert.equal(later.startX, later.x + 2 * RAIN_FALL - 0.16);
});
test('foliage auxiliary passes share root-anchored deformation and light flicker stays restrained', () => {
  const manifest = JSON.parse(
      fs.readFileSync(assetFile('public/generated/ink/ink-scenery/manifest.json'), 'utf8'),
    ) as Manifest,
    clip = manifest.asset.clips.fern!.d45!,
    sprite = new ActorSprite(
      'fern',
      manifest,
      new Map(manifest.pages.map((p) => [p.id, new Texture()])),
      clip,
    ),
    wind = new FoliageWind(sprite, 0.2),
    depth = new MeshDepthMaterial(),
    focus = new MeshBasicMaterial();
  wind.attach(depth);
  wind.attach(focus);
  wind.attach(focus);
  const programs = [sprite.material, sprite.edgeMaterial!, depth, focus].map((m) => {
    const p = {
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <alphatest_fragment>',
      uniforms: {},
    };
    m.onBeforeCompile(p as never, {} as WebGLRenderer);
    return p;
  });
  for (const p of programs) {
    assert.match(p.vertexShader, /position.y-foliageRoot/);
    assert.equal((p.vertexShader.match(/uniform float foliageTime/g) ?? []).length, 1);
    assert.equal((p.uniforms as Record<string, unknown>).foliageTime, wind.time);
  }
  wind.update(7, false);
  assert.equal(wind.strength.value, 0);
  wind.update(7, true);
  assert.ok(wind.strength.value > 0);
  for (let t = 0; t < 10; t += 0.01)
    assert.ok(lightFlicker(t, 0.31) > 0.85 && lightFlicker(t, 0.31) < 1.15);
  sprite.dispose();
  depth.dispose();
  focus.dispose();
});
