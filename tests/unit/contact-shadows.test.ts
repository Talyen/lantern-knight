import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ActorSprite } from '../../src/presentation/sprite';
import {
  contactFootprint,
  actorContactGeometry,
  contactShadowMaterial,
  poseActorContact,
  PropContactShadows,
} from '../../src/presentation/contact-shadows';
import { manifestFixture } from '../fixtures/manifest';
import { resolveClip } from '../../src/assets/schema';
import type { ArtPlacement } from '../../src/content/world-visuals';
import { content } from '../fixtures/content';
import { right, up } from '../../src/presentation/camera';

test('prepared supports follow slopes, reuse GPU buffers and fall back for legacy frames', () => {
  const manifest = manifestFixture('any-character');
  const frame = manifest.frames[0]!;
  frame.contact = [
    [-0.12, -0.03, 0.09, 0.025],
    [0.14, 0.02, 0.08, 0.025],
  ];
  const sprite = new ActorSprite(
      'actor',
      manifest,
      new Map(),
      resolveClip(manifest, 'idle', 'd45'),
    ),
    texture = new T.Texture(),
    shadow = new T.Mesh(actorContactGeometry(0.51, 0.374), contactShadowMaterial(texture, 0.48)),
    normal = new T.Vector3(-0.2, 1, 0.1).normalize();
  sprite.animator.start({ ...sprite.animator.clip, frames: [frame.id] });
  const positions = shadow.geometry.getAttribute('position');
  try {
    shadow.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    poseActorContact(shadow, sprite, normal);
    assert.equal(shadow.geometry.drawRange.count, 18);
    for (let i = 0; i < positions.count; i++) {
      const point = new T.Vector3()
        .fromBufferAttribute(positions, i)
        .applyQuaternion(shadow.quaternion);
      assert.ok(Math.abs(point.dot(normal)) < 1e-7);
    }
    const next = { ...frame, id: 'another-pose', contact: undefined };
    sprite.frameIndex.set(next.id, next);
    sprite.animator.start({ ...sprite.animator.clip, frames: [next.id] });
    poseActorContact(shadow, sprite, normal);
    assert.equal(shadow.geometry.drawRange.count, 6);
    assert.equal(shadow.geometry.getAttribute('contactStrength').getX(0), 1);
    assert.equal(shadow.geometry.getAttribute('position'), positions);
  } finally {
    sprite.dispose();
    shadow.geometry.dispose();
    shadow.material.dispose();
    texture.dispose();
  }
});

test('support blending follows displayed registration offsets without shifting the root', () => {
  const manifest = manifestFixture('blended-character'),
    frame = {
      ...manifest.frames[0]!,
      registration: {
        canvas: [100, 100] as [number, number],
        anchor: [50, 80] as [number, number],
        density: 100,
      },
      visualOffsetPx: [10, 10] as [number, number],
      contact: [[0, 0, 0.1, 0.03] as [number, number, number, number]],
    };
  const sprite = new ActorSprite(
      'actor',
      manifest,
      new Map(),
      resolveClip(manifest, 'idle', 'd45'),
    ),
    texture = new T.Texture(),
    shadow = new T.Mesh(actorContactGeometry(0.5, 0.4), contactShadowMaterial(texture, 0.48)),
    normal = new T.Vector3(0, 1, 0);
  sprite.lightingSample = {
    frame,
    next: { ...frame, id: 'next', contact: [[0.2, 0.2, 0.1, 0.03]] },
    blend: { from: frame.id, to: 'next', mix: 0.5, motion: false, guarded: false },
  };
  shadow.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
  try {
    poseActorContact(shadow, sprite, normal);
    const positions = shadow.geometry.getAttribute('position'),
      center = new T.Vector3();
    for (let i = 4; i < 8; i++) center.add(new T.Vector3().fromBufferAttribute(positions, i));
    center.multiplyScalar(0.25).applyQuaternion(shadow.quaternion);
    assert.ok(Math.abs(center.dot(right) - 0.2) < 1e-6);
    assert.ok(Math.abs(center.dot(up)) < 1e-6);
    assert.deepEqual(shadow.position.toArray(), [0, 0, 0]);
  } finally {
    sprite.dispose();
    shadow.geometry.dispose();
    shadow.material.dispose();
    texture.dispose();
  }
});

test('generic prepared prop supports respect mirroring and keep positive instance winding', () => {
  const manifest = manifestFixture('any-prop');
  manifest.asset.type = 'prop';
  manifest.asset.placement = 'upright';
  manifest.frames.forEach((f) => {
    f.contact = [[0.1, -0.03, 0.15, 0.04]];
  });
  const sprite = new ActorSprite('prop', manifest, new Map(), resolveClip(manifest, 'idle', 'd45')),
    texture = new T.Texture(),
    batch = new PropContactShadows(texture, 2);
  try {
    for (const mirror of [false, true]) {
      batch.add(
        {
          id: 'prop',
          asset: manifest.asset.id,
          clip: 'idle',
          x: 0,
          z: 0,
          scale: 2.2,
          footprint: [3, 4],
          mirror,
          purpose: 'Fixture',
        },
        sprite,
        content.area('court'),
      );
      const matrix = new T.Matrix4();
      batch.mesh.getMatrixAt(batch.mesh.count - 2, matrix);
      assert.ok(matrix.determinant() > 0);
    }
  } finally {
    batch.dispose();
    sprite.dispose();
    texture.dispose();
  }
});

// An unregistered prop must ground without adding collision or authored data.
test('contact grounding derives unregistered sizes and respects explicit exclusions', () => {
  const manifest = manifestFixture();
  manifest.asset.type = 'prop';
  manifest.asset.placement = 'upright';
  manifest.asset.projection = 'painted-cutout';
  const sprite = new ActorSprite('prop', manifest, new Map(), resolveClip(manifest, 'idle', 'd45')),
    p: ArtPlacement = {
      id: 'prop',
      asset: manifest.asset.id,
      clip: 'idle',
      x: 2,
      z: 3,
      purpose: 'Fixture',
    },
    base = contactFootprint(p, sprite)!;
  assert.ok(base[0] > 0 && base[1] > 0);
  assert.deepEqual(
    contactFootprint({ ...p, scale: 2 }, sprite),
    base.map((n) => n * 2),
  );
  assert.deepEqual(contactFootprint({ ...p, scale: 2, footprint: [3, 4] }, sprite), [3, 4]);
  for (const excluded of [
    { ...p, shadow: 'none' as const },
    { ...p, y: 1 },
    { ...p, role: 'attachment' as const, mount: { to: 'table', offset: [0, 1, 0] as const } },
  ])
    assert.equal(contactFootprint(excluded, sprite), undefined);
  manifest.asset.placement = 'ground';
  assert.equal(contactFootprint(p, sprite), undefined);
  sprite.dispose();
});

test('batched contact shadows follow visibility and fading without orphaned shadows', () => {
  const manifest = manifestFixture();
  manifest.asset.type = 'prop';
  manifest.asset.placement = 'upright';
  manifest.asset.projection = 'painted-cutout';
  const sprite = new ActorSprite('prop', manifest, new Map(), resolveClip(manifest, 'idle', 'd45')),
    texture = new T.Texture(),
    batch = new PropContactShadows(texture, 2),
    p: ArtPlacement = {
      id: 'prop',
      asset: manifest.asset.id,
      clip: 'idle',
      x: 2,
      z: 3,
      footprint: [3, 4],
      purpose: 'Fixture',
    };
  batch.add(p, sprite, content.area('court'));
  batch.add({ ...p, shadow: 'none' }, sprite, content.area('court'));
  assert.equal(batch.mesh.count, 3);
  const matrix = new T.Matrix4();
  batch.mesh.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[12], 2);
  assert.equal(matrix.elements[14], 3);
  const opacity = batch.mesh.geometry.getAttribute('contactOpacity');
  sprite.material.opacity = 0.5;
  batch.update();
  assert.ok(Math.abs(opacity.getX(0) - 0.2) < 1e-6);
  sprite.mesh.visible = false;
  batch.update();
  assert.equal(opacity.getX(0), 0);
  sprite.mesh.visible = true;
  batch.update();
  assert.ok(opacity.getX(0) > 0);
  const room = new T.Group();
  room.add(batch.mesh);
  batch.dispose();
  assert.equal(room.children.length, 0);
  sprite.dispose();
  texture.dispose();
});
