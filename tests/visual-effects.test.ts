import { assetFile } from '../tools/assets/paths';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultVisualEffects,
  visualEffectLabels,
  dryWeather,
  normalizeWeather,
  lightFlicker,
} from '../src/content/visual-effects';
import { parseSettings } from '../src/core/save';
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
import { MeshDepthMaterial, MeshBasicMaterial, Texture, WebGLRenderer } from 'three';
import fs from 'node:fs';
import type { Manifest } from '../src/assets/schema';

test('approved preferences migrate independently from camera, DOF and checkpoints', () => {
  assert.equal(Object.keys(visualEffectLabels).length, 9);
  assert.ok(Object.values(defaultVisualEffects()).every(Boolean));
  for (const legacy of [
    { version: 1, renderScale: 0.75, showDebug: true },
    { version: 2, verticalSpan: 13, renderScale: 0.75, showDebug: true },
    { version: 3, verticalSpan: 15, renderScale: 1, showDebug: false, depthOfField: 0.4 },
    { version: 4, verticalSpan: 11, renderScale: 0.5, showDebug: true, depthOfField: 0 },
  ]) {
    const result = parseSettings(legacy);
    assert.equal(result.version, 5);
    assert.equal(result.renderScale, legacy.renderScale);
    assert.equal(result.showDebug, legacy.showDebug);
    assert.deepEqual(result.visualEffects, defaultVisualEffects());
    if ('depthOfField' in legacy) assert.equal(result.depthOfField, legacy.depthOfField);
  }
  const current = parseSettings({
    version: 4,
    verticalSpan: 9,
    renderScale: 1,
    showDebug: false,
    depthOfField: 0,
  });
  current.visualEffects.rain = false;
  current.visualEffects.bloom = false;
  assert.deepEqual(parseSettings(current), current);
  assert.throws(() =>
    parseSettings({ ...current, visualEffects: { ...current.visualEffects, outlines: true } }),
  );
  assert.throws(() =>
    parseSettings({ ...current, visualEffects: { ...current.visualEffects, bloom: 1 } }),
  );
  assert.equal(dryWeather().rain, 0);
  assert.deepEqual(normalizeWeather({ rain: NaN, wind: { x: Infinity, z: 4 } }), {
    rain: 0,
    wind: { x: 0, z: 3 },
  });
});
test('a seeded drop owns an invariant endpoint and triggers its splash at impact', () => {
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
