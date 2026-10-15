import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ShadowProxies } from '../../src/presentation/shadow-proxies';
import { silhouetteMatrix } from '../../src/presentation/silhouette-pose';
import { ActorSprite } from '../../src/presentation/sprite';
import { manifestFixture } from '../fixtures/manifest';
import { makeCamera, outward } from '../../src/presentation/camera';
import { emptyScene } from '../../src/editor/default-scene';
import { resolveScene } from '../../src/content/world-art';
import { Simulation } from '../../src/core/simulation';
import { content } from '../fixtures/content';
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
  const sim = new Simulation(content),
    art = resolveScene(emptyScene()).visuals;
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
  proxies.build(sim.view, art, [sprite]);
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
  art.groundInteraction = {
    asset: 'test',
    frame: 'test',
    hash: 'a'.repeat(64),
    dimensions: [64, 64],
    destinations: [],
    regions: [
      {
        id: 'tree',
        name: 'Tree',
        depth: { kind: 'anchor', point },
        mask: [
          {
            outer: [
              [0.4, 0.3],
              [0.6, 0.3],
              [0.6, 0.6],
              [0.4, 0.6],
            ],
            holes: [
              [
                [0.48, 0.4],
                [0.52, 0.4],
                [0.52, 0.45],
                [0.48, 0.45],
              ],
            ],
          },
        ],
      },
    ],
  };
  const proxies = new ShadowProxies(new T.DirectionalLight());
  proxies.build(new Simulation(content).view, art, []);
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
});
