import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ActorSprite } from '../../src/presentation/sprite';
import { contactFootprint, PropContactShadows } from '../../src/presentation/contact-shadows';
import { manifestFixture } from '../fixtures/manifest';
import { resolveClip } from '../../src/assets/schema';
import type { ArtPlacement } from '../../src/content/world-visuals';
import { content } from '../fixtures/content';

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
    { ...p, wallFace: 'wall' },
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
