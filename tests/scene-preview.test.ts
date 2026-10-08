import test from 'node:test';
import assert from 'node:assert/strict';
import { readScenePreview, previewHero } from '../src/scene-preview';
import { sandboxContent } from '../src/content/sandbox-world';
import { isSupportedPosition, heightAt } from '../src/content/world';
import { defaultLook } from '../src/presentation/lighting-profiles';
import { sceneOptions } from '../tools/scene-workflow';

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

test('scene commands reject unknown rooms and options before running checks or starting previews', () => {
  assert.deepEqual(sceneOptions(['--scene', 'court', '--capture', '--local']), {
    scene: 'court',
    capture: true,
    local: true,
    skipReload: false,
  });
  for (const args of [
    [],
    ['--scene', 'unknown'],
    ['--scene'],
    ['--scene', 'court', '--skip-tests'],
    ['--scene', 'court', '--scene', 'court'],
  ])
    assert.throws(() => sceneOptions(args));
});

test('scene traversal and foreground fixtures remain supported by the authored rooms', async () => {
  const { sceneFixture } = await import('../tools/scene-fixtures');
  for (const scene of ['court', 'upper-landing']) {
    const area = sandboxContent.area(scene),
      fixture = sceneFixture(scene, area.entries[0]!);
    for (const p of [...fixture.route, fixture.foreground])
      assert.ok(isSupportedPosition(area, p, 0.3), `${scene}: ${p.x}/${p.z}`);
  }
});
