import { hash } from '../../tools/compiler';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture, Vector3, MeshBasicMaterial } from 'three';
import { readAsset } from '../../tools/assets/io';
import { readRegistration } from '../../tools/assets/data';
import { parseRegistration } from '../../src/assets/registration';
import { parseManifest, resolveClip } from '../../src/assets/schema';
import { sampleAnimation } from '../../src/core/animation-treatment';
import { clipDuration, frameAt } from '../../src/core/animation';
import { timedWalk, remapWalkTime } from '../../src/core/locomotion-timing';
import {
  AnimationBlendShader,
  registeredTrim,
} from '../../src/presentation/animation-blend-shader';
import { ActorSprite } from '../../src/presentation/sprite';
import { makeCamera, trimmedBounds } from '../../src/core/camera';

const m = parseManifest(
    JSON.parse(await readAsset('public/generated/ink/ink-hero-current/manifest.json', 'utf8')),
  ),
  registration = readRegistration();

test('mixed-density guarded sampling keeps the foot fixed and restores native held geometry', () => {
  const textures = new Map(m.pages.map((p) => [p.id, new Texture()])),
    flow = { ...registration.animation, texture: new Texture() },
    camera = makeCamera(16 / 9),
    foot = new Vector3(1, 0.2, 2);
  const clip = resolveClip(m, 'sweep', 'd00'),
    sprite = new ActorSprite('mixed', m, textures, clip),
    material = new MeshBasicMaterial(),
    shader = new AnimationBlendShader([material]);
  const a = m.frames.find((f) => f.id === clip.frames[0])!,
    b = m.frames.find((f) => f.id === clip.frames[1])!,
    pair = flow.pairs.find((p) => p.from === a.id && p.to === b.id)!;
  assert.notEqual(a.registration!.density, b.registration!.density);
  const sample = { from: a.id, to: b.id, mix: 0.4, motion: true, guarded: true };
  shader.update(sample, m, a, b, textures, flow);
  for (const [f, u] of [
    [a, shader.uniforms.walkTrimA],
    [b, shader.uniforms.walkTrimB],
  ] as const) {
    const t = registeredTrim(m, { ...f, visualOffsetPx: flow.offsets[f.id] }, pair);
    assert.equal(u.value.x, t[0] / pair.canvas[0]);
    assert.equal(u.value.z, t[2] / pair.canvas[0]);
  }
  sprite.animator.seek(clip.durationsMs[0]! * 0.4);
  sprite.showAnimation(foot, camera, 'guarded', flow);
  assert.deepEqual(sprite.mesh.position, foot);
  sprite.stabilized = false;
  sprite.showAnimation(foot, camera, 'original', flow);
  const bounds = trimmedBounds(a.registration!, a.trim),
    p = sprite.geometry.getAttribute('position');
  assert.ok(Math.abs(p.getX(0) - bounds.left) < 1e-6);
  assert.ok(Math.abs(p.getY(0) - bounds.top) < 1e-6);
  const unsupported = { ...flow, pairs: flow.pairs.map((p) => ({ ...p, supported: false })) };
  sprite.showAnimation(foot, camera, 'guarded', unsupported);
  assert.equal(sprite.lightingSample!.blend, undefined);
  sprite.dispose();
  material.dispose();
  flow.texture.dispose();
  textures.forEach((t) => t.dispose());
  const six = resolveClip(m, 'walk', 'd45'),
    eight = resolveClip(m, 'walk', 'd135');
  assert.ok(
    Math.abs(remapWalkTime(six, eight, clipDuration(six) * 1.7) - clipDuration(eight) * 1.7) < 1e-8,
  );
});

test('registration rejects duplicate pairs, escaped crops and degenerate sword lines', () => {
  // These mutations exercise animation validation; large terrain alpha masks are irrelevant.
  const fixture = { ...registration, coverage: { masks: {}, sockets: {} } };
  const value = structuredClone(fixture);
  value.animation.pairs.push(value.animation.pairs[0]!);
  assert.throws(() => parseRegistration(value), /Duplicate/);
  const crop = structuredClone(fixture);
  crop.animation.pairs[0]!.rect[0] = crop.animation.width;
  assert.throws(() => parseRegistration(crop), /escapes/);
  const blade = structuredClone(fixture);
  Object.assign(blade.animation.pairs[0]!, {
    supported: true,
    weaponVisibility: 'visible',
    silhouetteAgreement: 1,
    colorError: 0,
    rejectionReason: null,
    sword: { a: [1, 1, 1, 1], b: [2, 2, 3, 3], width: 8 },
  });
  assert.throws(() => parseRegistration(blade), /Degenerate/);
  const hidden = registration.animation.pairs.find(
    (p) => p.supported && p.weaponVisibility === 'hidden',
  )!;
  assert.ok(hidden);
  assert.equal(hidden.sword, undefined);
  const invalid = structuredClone(fixture);
  const pair = invalid.animation.pairs.find((p) => p.supported && p.weaponVisibility === 'hidden')!;
  pair.weaponVisibility = 'uncertain';
  assert.throws(() => parseRegistration(invalid), /requires sword|visibility/);
  const hold = structuredClone(fixture);
  hold.animation.pairs[0]!.holdFraction = 1;
  assert.throws(() => parseRegistration(hold));
});

test('canonical artwork remains byte-identical', async () => {
  assert.equal(
    hash(await readAsset('references/canon/image(3).png')),
    '74ba2c2004e5b30da8c35f192fd725957a2a24f8b26de0ad58163608cb7dd09c',
  );
});

test('one-tick sweep launch and damage poses are visible at their exact simulation boundaries', () => {
  const clip = resolveClip(m, 'sweep', 'd90');
  assert.equal(frameAt(clip, 17000 / 60), clip.frames[4]);
  assert.equal(sampleAnimation(clip, 17000 / 60, 'guarded').from, clip.frames[4]);
  assert.equal(frameAt(clip, 300), clip.frames[5]);
  assert.equal(sampleAnimation(clip, 300, 'guarded').from, clip.frames[5]);
});

test('weighted cardinal run loops start on the first drawing at the exact 40-tick boundary', () => {
  const walk = timedWalk(
    resolveClip(m, 'walk', 'd135'),
    'weighted',
    registration.animation.clips['walk:d135']!.weightedHoldsMs,
  );
  assert.equal(frameAt(walk, 40000 / 60), walk.frames[0]);
  assert.equal(sampleAnimation(walk, 40000 / 60, 'guarded').from, walk.frames[0]);
});
