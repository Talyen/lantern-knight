import test from 'node:test';
import assert from 'node:assert/strict';
import { actorFrameScales, scaleActorRegistration } from '../../tools/assets/actor-scale';
import motion from '../../authoring/hero-motion.json';
import scaleRecipe from '../../authoring/hero-scale.json';
import { heroTimings } from '../../src/content/hero-actions';
import { trimmedBounds } from '../../src/assets/sprite-registration';

test('hero review covers every clip/direction and leaves idle at its current size', () => {
  const clips = Object.entries(heroTimings).flatMap(([id, headings]) =>
    Object.keys(headings).map((heading) => ({
      id,
      heading,
      frames: Object.keys(motion.frames).filter((key) => key.startsWith(`${id}-${heading}-`)),
    })),
  );
  const baseline = {
    ...scaleRecipe,
    clips: Object.fromEntries(
      Object.entries(scaleRecipe.clips).filter(([key]) => Object.hasOwn(motion.clips, key)),
    ),
  };
  const scales = actorFrameScales(baseline, clips);
  assert.equal(scales.size, Object.keys(motion.frames).length);
  for (const [id, scale] of scales) {
    if (id.startsWith('idle-') || id.startsWith('ready-')) assert.equal(scale, 1);
    assert.ok(scale >= 0.85 && scale <= 1.2, id);
  }
  assert.equal(scales.get('walk-d00-00'), 1.16);
  assert.equal(scales.get('death-d270-04'), 1);
  assert.ok(Math.abs(scales.get('sweep-d90-00')! - 1.06 * 1.06) < 1e-12);
  assert.throws(() => actorFrameScales(baseline, clips.slice(1)), /exactly/);
  assert.throws(
    () =>
      actorFrameScales(
        {
          ...baseline,
          frames: { 'absent-00': 1.1 },
        },
        clips,
      ),
    /Unknown actor scale drawing/,
  );
  assert.throws(() => actorFrameScales({ ...scaleRecipe, clips: { 'idle:d00': 0 } }, clips));
});

test('scale changes world geometry uniformly about the native foot pivot', () => {
  const native = {
    canvas: [640, 700] as [number, number],
    anchor: [300, 560] as [number, number],
    density: 320,
  };
  const trim: [number, number, number, number] = [70, 40, 480, 620];
  const before = trimmedBounds(native, trim);
  for (const scale of [0.88, 1, 1.16]) {
    const corrected = scaleActorRegistration(native, scale),
      after = trimmedBounds(corrected, trim);
    assert.equal(native.density, 320);
    assert.deepEqual(corrected.anchor, native.anchor);
    assert.deepEqual(corrected.canvas, native.canvas);
    for (const side of ['left', 'right', 'top', 'bottom'] as const)
      assert.ok(Math.abs(after[side] - before[side] * scale) < 1e-12);
  }
  for (const scale of [0, -1, NaN, Infinity])
    assert.throws(() => scaleActorRegistration(native, scale), /Invalid actor scale/);
});
