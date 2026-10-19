import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera } from 'three';
import { CameraMotionBlur } from '../../src/presentation/camera-motion-blur';
import { defaultVisualEffects } from '../../src/content/visual-effects';
import { parseSettings } from '../../src/platform/settings';

function camera() {
  const c = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  c.position.z = 10;
  c.updateMatrixWorld();
  return c;
}

test('camera shutter follows screen direction, stops immediately, and has stable exposure across refresh rates', () => {
  const sample = (ms: number) => {
    const c = camera(),
      blur = new CameraMotionBlur();
    assert.equal(blur.update(c, ms, true).length(), 0);
    c.position.x += ms * 0.003;
    c.updateMatrixWorld();
    const offset = blur.update(c, ms, true).clone();
    assert.ok(offset.x < 0);
    assert.equal(offset.y, 0);
    assert.equal(blur.update(c, ms, true).length(), 0);
    return offset.x;
  };
  assert.ok(Math.abs(sample(1000 / 60) - sample(1000 / 120)) < 1e-10);
});

test('disabled effects, cuts, zoom, resize/reset and stalled frames never smear old movement', () => {
  const c = camera(),
    blur = new CameraMotionBlur();
  const move = (ms = 16, enabled = true, distance = 0.05) => {
    c.position.x += distance;
    c.updateMatrixWorld();
    return blur.update(c, ms, enabled).length();
  };
  move();
  assert.ok(move() > 0);
  assert.equal(move(16, false), 0);
  assert.equal(move(), 0);
  assert.equal(move(500), 0);
  assert.equal(move(16, true, 5), 0);
  c.zoom = 2;
  c.updateProjectionMatrix();
  assert.equal(move(), 0);
  c.rotation.y = 0.1;
  assert.equal(move(), 0);
  blur.reset();
  assert.equal(move(), 0);
});

test('pre-experiment player settings retain values and opt out of camera blur', () => {
  const { motionBlur: _, ...oldEffects } = defaultVisualEffects();
  const settings = {
    version: 7,
    uiScale: 1.15,
    audio: { master: 0.4, effects: 0.8, ambience: 0.65, muted: false },
    renderScale: 0.75,
    showDebug: false,
    verticalSpan: 11,
    depthOfField: 0.5,
    visualEffects: oldEffects,
  };
  const restored = parseSettings(settings);
  assert.equal(restored.visualEffects.motionBlur, false);
  assert.equal(restored.uiScale, 1.15);
  assert.equal(restored.audio.master, 0.4);
  assert.equal(
    parseSettings({ ...restored, visualEffects: { ...restored.visualEffects, motionBlur: true } })
      .visualEffects.motionBlur,
    true,
  );
  assert.equal(defaultVisualEffects().motionBlur, false);
});
