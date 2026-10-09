import test from 'node:test';
import assert from 'node:assert/strict';
import { readScenePreview, previewHero } from '../../src/sandbox/preview';
import { sandboxContent } from '../../src/content/sandbox-world';
import { isSupportedPosition, heightAt } from '../../src/content/world';
import { defaultLook } from '../../src/presentation/lighting-profiles';

test('preview reload reconciles blocked or moved positions without accepting corrupt state', () => {
  const state = {
    version: 1,
    scene: 'court',
    hero: { x: 999, z: 999, yaw: 0.8 },
    span: 11,
    scale: 1,
    paused: true,
    mode: 'lighting',
    look: { ...defaultLook, rig: 'silver', strength: 0.8 },
  };
  const restored = readScenePreview(JSON.stringify(state), sandboxContent)!;
  assert.ok(restored);
  assert.ok(isSupportedPosition(sandboxContent.area('court'), restored.hero, 0.3));
  const hero = previewHero(restored, sandboxContent);
  assert.equal(hero.px, hero.x);
  assert.equal(hero.pz, hero.z);
  assert.equal(hero.py, heightAt(sandboxContent.area('court'), hero.x, hero.z));
  assert.equal(hero.yaw, 0.8);
  assert.equal(restored.paused, true);
  assert.equal(restored.look.rig, 'silver');
  assert.equal(restored.span, 11);
  for (const bad of [
    '{',
    JSON.stringify({ ...state, scene: 'missing' }),
    JSON.stringify({ ...state, scale: 0 }),
    JSON.stringify({ ...state, hero: { x: null, z: 0, yaw: 0 } }),
  ])
    assert.equal(readScenePreview(bad, sandboxContent), undefined);
});
