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

test('reviewed sole contacts follow a slope and restore generic grounding for other poses or changed art', () => {
  const manifest = manifestFixture();
  manifest.hash = '03ac4b4fbb1459f85a56b3bb9c48af73d5b2144ba0e302513088e3cab151889a';
  const clip = manifest.asset.clips.idle!.d45!;
  clip.frames = ['idle-d90-00'];
  const sprite = new ActorSprite('hero', manifest, new Map(), clip),
    texture = new T.Texture(),
    shadow = new T.Mesh(
      actorContactGeometry(0.51, 0.374, true),
      contactShadowMaterial(texture, 0.48),
    ),
    normal = new T.Vector3(-0.2, 1, 0.1).normalize();
  try {
    poseActorContact(shadow, sprite, normal);
    const positions = shadow.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++)
      assert.ok(Math.abs(new T.Vector3().fromBufferAttribute(positions, i).dot(normal)) < 1e-7);
    const reviewed = Array.from(positions.array);
    clip.frames = ['unreviewed-action'];
    poseActorContact(shadow, sprite, normal);
    const generic = Array.from(positions.array).slice(0, 12);
    assert.equal(shadow.geometry.drawRange.count, 6);
    assert.notDeepEqual(generic, reviewed);
    const original = new T.PlaneGeometry(0.51, 0.374);
    assert.deepEqual(generic, Array.from(original.getAttribute('position').array));
    original.dispose();
    clip.frames = ['idle-d90-00'];
    poseActorContact(shadow, sprite, normal);
    assert.deepEqual(Array.from(positions.array), reviewed);
    assert.equal(shadow.geometry.drawRange.count, 12);
    assert.equal(
      shadow.geometry.getAttribute('position'),
      positions,
      'Stance changes reuse the uploaded buffer',
    );
    poseActorContact(shadow, sprite, new T.Vector3(-1, 1, 0).normalize());
    assert.deepEqual(
      Array.from(positions.array).slice(0, 12),
      generic,
      'An edge-on floor keeps finite generic grounding',
    );
    manifest.hash = 'b'.repeat(64);
    poseActorContact(shadow, sprite, normal);
    assert.deepEqual(Array.from(positions.array).slice(0, 12), generic);
  } finally {
    sprite.dispose();
    shadow.geometry.dispose();
    shadow.material.dispose();
    texture.dispose();
  }
});

test('toolbox base contacts stay drawable when the artwork is mirrored', () => {
  const id = 'library-animation-01b6ad35f0ea6d5b-ffa5b716b5a5-interact-native',
    manifest = manifestFixture(id);
  manifest.hash = 'cd514729d28908d8b701ebe29eb09065dfbc3e18ef98e81b355542de518de1d6';
  manifest.asset.type = 'prop';
  manifest.asset.placement = 'upright';
  const sprite = new ActorSprite(
      'toolbox',
      manifest,
      new Map(),
      resolveClip(manifest, 'idle', 'd45'),
    ),
    texture = new T.Texture(),
    batch = new PropContactShadows(texture, 2);
  try {
    for (const mirror of [false, true]) {
      batch.add(
        {
          id: 'toolbox',
          asset: id,
          clip: 'idle',
          x: 0,
          z: 0,
          scale: 2.2,
          mirror,
          purpose: 'Fixture',
        },
        sprite,
        content.area('court'),
      );
      const matrix = new T.Matrix4();
      batch.mesh.getMatrixAt(batch.mesh.count - 1, matrix);
      assert.ok(
        matrix.determinant() > 0,
        'Instanced ground contacts cannot use reversed face winding',
      );
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
  assert.equal(batch.mesh.count, 1);
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
