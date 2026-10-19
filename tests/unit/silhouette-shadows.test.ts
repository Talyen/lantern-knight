import { rectangle, groundFixture } from '../fixtures/ground';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ShadowProxies } from '../../src/presentation/shadow-proxies';
import { silhouetteMatrix } from '../../src/presentation/silhouette-pose';
import { ActorSprite } from '../../src/presentation/sprite';
import { manifestFixture } from '../fixtures/manifest';
import { makeCamera, outward, right } from '../../src/presentation/camera';
import { regionDepth } from '../../src/presentation/ground-occlusion';
import { emptyScene } from '../../src/editor/default-scene';
import { resolveScene } from '../../src/content/world-art';
import { artworkFloorLayout } from '../../src/content/floor-layout';

test('contact-marked props cast live alpha silhouettes without owning their drawing resources', () => {
  const manifest = manifestFixture('solid-prop');
  manifest.asset.type = 'prop';
  manifest.asset.placement = 'upright';
  manifest.asset.projection = 'projected-world';
  const a = new T.Texture(),
    b = new T.Texture(),
    sprite = new ActorSprite(
      'solid-prop',
      manifest,
      new Map([['atlas-0', a]]),
      manifest.asset.clips.idle!.d45!,
    );
  sprite.show(manifest.frames[0]!.id, new T.Vector3(2, 0, 3), makeCamera(1));
  sprite.mesh.scale.set(-2, 2, 2);
  sprite.mesh.rotateZ(0.2);
  const art = resolveScene(emptyScene()).visuals;
  art.props = [
    {
      id: sprite.id,
      asset: manifest.asset.id,
      clip: 'idle',
      x: 2,
      z: 3,
      shadow: 'contact',
      purpose: 'Test',
    },
    {
      id: 'contact-only',
      asset: manifest.asset.id,
      clip: 'idle',
      x: 0,
      z: 0,
      shadow: 'contact-only',
      purpose: 'Low item retains independent contact grounding',
    },
    {
      id: 'disabled',
      asset: manifest.asset.id,
      clip: 'idle',
      x: 0,
      z: 0,
      shadow: 'none',
      purpose: 'Test',
    },
  ];
  const proxies = new ShadowProxies(new T.DirectionalLight());
  proxies.build(art, [sprite]);
  proxies.updateScenery([sprite]);
  assert.equal(proxies.proxies.children.length, 1);
  const caster = proxies.proxies.children[0] as T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  assert.equal(caster.geometry, sprite.geometry);
  assert.equal(caster.material.map, a);
  assert.equal(caster.customDepthMaterial, caster.customDistanceMaterial);
  caster.updateMatrix();
  assert.deepEqual(caster.matrix.elements, silhouetteMatrix(sprite, new T.Matrix4()).elements);
  assert.equal(
    caster.intersectsFrustum(new T.Frustum()),
    false,
    'casters never appear in beauty passes',
  );
  sprite.material.map = b;
  sprite.mesh.position.x = 5;
  sprite.mesh.visible = false;
  proxies.updateScenery([sprite]);
  assert.equal(caster.position.x, 5);
  assert.equal(caster.visible, false);
  assert.equal(caster.material.map, b);
  assert.equal((caster.customDepthMaterial as T.MeshDepthMaterial).map, b);
  let geometryDisposed = 0,
    textureDisposed = 0,
    materialDisposed = 0;
  sprite.geometry.addEventListener('dispose', () => geometryDisposed++);
  b.addEventListener('dispose', () => textureDisposed++);
  caster.material.addEventListener('dispose', () => materialDisposed++);
  proxies.reset();
  assert.equal(proxies.proxies.children.length, 0);
  assert.equal(materialDisposed, 1);
  assert.equal(geometryDisposed, 0);
  assert.equal(textureDisposed, 0);
  sprite.dispose();
  a.dispose();
  b.dispose();
});

test('painted masks produce physical silhouette geometry at their authored depth', () => {
  const art = resolveScene(emptyScene()).visuals,
    layout = artworkFloorLayout(art.editorFloor!.width, art.editorFloor!.depth);
  const point = layout.world([0.5, 0.7]);
  art.groundInteraction = groundFixture(
    [
      {
        id: 'tree',
        name: 'Tree',
        depth: { kind: 'anchor', point },
        mask: [
          {
            outer: rectangle(0.4, 0.3, 0.6, 0.6),
            holes: [rectangle(0.48, 0.4, 0.52, 0.45)],
          },
        ],
      },
    ],
    { asset: 'test', frame: 'test' },
  );
  const proxies = new ShadowProxies(new T.DirectionalLight());
  proxies.build(art, []);
  assert.equal(proxies.proxies.children.length, 1);
  const mesh = proxies.proxies.children[0] as T.Mesh,
    positions = mesh.geometry.getAttribute('position'),
    depth = point.x * outward.x + point.z * outward.z;
  for (let i = 0; i < positions.count; i++) {
    assert.ok(positions.getY(i) > 0);
    assert.ok(
      Math.abs(positions.getX(i) * outward.x + positions.getZ(i) * outward.z - depth) < 1e-5,
    );
  }
  let disposed = 0;
  mesh.geometry.addEventListener('dispose', () => disposed++);
  proxies.reset();
  assert.equal(disposed, 1);
  art.groundInteraction = {
    ...art.groundInteraction,
    regions: [
      {
        ...art.groundInteraction.regions[0]!,
        depth: {
          kind: 'boundary',
          points: [layout.world([0.4, 0.7]), layout.world([0.5, 0.9]), layout.world([0.6, 0.7])],
        },
      },
    ],
  };
  const region = art.groundInteraction.regions[0]!;
  proxies.build(art, []);
  const curved = (proxies.proxies.children[0] as T.Mesh).geometry.getAttribute('position');
  for (let i = 0; i < curved.count; i += 3) {
    const center = new T.Vector3();
    for (let j = 0; j < 3; j++)
      center.add(new T.Vector3().fromBufferAttribute(curved, i + j).multiplyScalar(1 / 3));
    const u = center.dot(right) / art.editorFloor!.width + 0.5;
    assert.ok(
      Math.abs(center.x * outward.x + center.z * outward.z - regionDepth(region, u, layout)) < 1e-5,
      'Triangle interiors follow every bend in the receiver depth boundary',
    );
  }
  proxies.reset();
});

test('disconnected painted contours batch without changing triangles, holes or region ownership', () => {
  const art = resolveScene(emptyScene()).visuals;
  const layout = artworkFloorLayout(art.editorFloor!.width, art.editorFloor!.depth);
  const masks = [
    { outer: rectangle(0.2, 0.2, 0.4, 0.4), holes: [rectangle(0.25, 0.25, 0.3, 0.3)] },
    { outer: rectangle(0.6, 0.2, 0.8, 0.4), holes: [] },
  ];
  const region = {
    id: 'tree',
    name: 'Tree',
    depth: { kind: 'anchor' as const, point: layout.world([0.5, 0.8]) },
    mask: masks,
  };
  art.groundInteraction = groundFixture([region], { asset: 'test', frame: 'test' });
  const sun = new T.DirectionalLight(),
    batched = new ShadowProxies(sun);
  batched.build(art, []);
  assert.equal(batched.proxies.children.length, 1);
  const triangles: number[] = [];
  for (const mask of masks) {
    const single = new ShadowProxies(sun);
    single.build(
      {
        ...art,
        groundInteraction: { ...art.groundInteraction, regions: [{ ...region, mask: [mask] }] },
      },
      [],
    );
    triangles.push(
      ...(single.proxies.children[0] as T.Mesh).geometry.getAttribute('position').array,
    );
    single.reset();
  }
  assert.deepEqual(
    [...(batched.proxies.children[0] as T.Mesh).geometry.getAttribute('position').array],
    triangles,
  );
  batched.reset();
});
