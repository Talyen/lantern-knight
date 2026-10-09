import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { readAsset } from '../../tools/assets/io';
import { parseManifest } from '../../src/assets/schema';
import { assetCatalog } from '../../src/content/visuals';
import { worldVisuals } from '../fixtures/visuals';
import { content } from '../fixtures/visuals';
import { makeCamera, right, up, outward, resizeCamera } from '../../src/core/camera';
import {
  SceneSurround,
  groundFootprintGeometry,
  insetGround,
} from '../../src/presentation/scene-surround';
import { defaultLook } from '../../src/presentation/lighting-profiles';

test('bounded terrain faces upward and still supports the entire playable rectangle', () => {
  for (const id of ['court', 'upper-landing']) {
    const art = worldVisuals[id]!,
      area = content.area(id),
      b = art.interior ?? area.bounds;
    const points = art.interior
      ? [
          { x: b.minX, z: b.minZ },
          { x: b.maxX, z: b.minZ },
          { x: b.maxX, z: b.maxZ },
          { x: b.minX, z: b.maxZ },
        ]
      : insetGround(art.surround!.ground, 1.4);
    const geometry = groundFootprintGeometry(points, () => 0),
      material = new T.MeshBasicMaterial(),
      floor = new T.Mesh(geometry, material);
    floor.updateMatrixWorld();
    try {
      for (let x = 0; x <= 8; x++)
        for (let z = 0; z <= 8; z++) {
          const ray = new T.Raycaster(
            new T.Vector3(
              area.bounds.minX + ((area.bounds.maxX - area.bounds.minX) * x) / 8,
              2,
              area.bounds.minZ + ((area.bounds.maxZ - area.bounds.minZ) * z) / 8,
            ),
            new T.Vector3(0, -1, 0),
          );
          assert.ok(
            ray.intersectObject(floor).length,
            `${id} has no upward ground under ${x}/${z}`,
          );
        }
    } finally {
      geometry.dispose();
      material.dispose();
    }
  }
});

test('parallax uses camera displacement and releases resized card pools without releasing leased textures', async () => {
  const definition = worldVisuals.court!.surround!,
    id = definition.layers[0]!.asset;
  const manifest = parseManifest(JSON.parse(await readAsset('public/' + assetCatalog[id], 'utf8'))),
    textures = new Map(manifest.pages.map((p) => [p.id, new T.Texture()]));
  const surround = new SceneSurround(new Map([[id, { manifest, textures, release() {} }]])),
    camera = makeCamera(16 / 9),
    target = new T.Vector3();
  let textureDisposals = 0;
  for (const texture of textures.values())
    texture.addEventListener('dispose', () => textureDisposals++);
  try {
    assert.throws(() => new SceneSurround(new Map()).build(definition), /missing surround art/);
    surround.build(definition);
    surround.update(camera, target, defaultLook, true);
    const meshes = surround.scene.children as T.InstancedMesh[];
    const landmark = (mesh: T.InstancedMesh) => {
      const matrix = new T.Matrix4();
      mesh.getMatrixAt((mesh.userData.cells as Map<string, number>).get('0:0')!, matrix);
      return new T.Vector3().setFromMatrixPosition(matrix);
    };
    const before = meshes.map(landmark);
    const move = right
      .clone()
      .multiplyScalar(0.1)
      .addScaledVector(up, 0.2)
      .addScaledVector(outward, 0.6);
    target.add(move);
    camera.position.add(move);
    camera.lookAt(target);
    surround.update(camera, target, defaultLook, true);
    for (const [i, mesh] of meshes.entries()) {
      const expected = right
        .clone()
        .multiplyScalar(0.1 * (1 - definition.layers[i]!.parallax))
        .addScaledVector(up, 0.2 * (1 - definition.layers[i]!.parallax));
      assert.ok(landmark(mesh).sub(before[i]!).distanceTo(expected) < 1e-6);
    }
    const held = landmark(meshes[0]!);
    surround.update(camera, target, defaultLook, true);
    assert.ok(landmark(meshes[0]!).distanceTo(held) < 1e-9);
    resizeCamera(camera, 2520, 1080, 15);
    surround.update(camera, target, defaultLook, true);
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    surround.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
      }
    });
    let geometryDisposals = 0,
      materialDisposals = 0;
    for (const g of geometries) g.addEventListener('dispose', () => geometryDisposals++);
    for (const m of materials) m.addEventListener('dispose', () => materialDisposals++);
    resizeCamera(camera, 1440, 1080, 9);
    surround.update(camera, target, defaultLook, false);
    surround.dispose();
    assert.equal(geometryDisposals, geometries.size);
    assert.equal(materialDisposals, materials.size);
    assert.equal(textureDisposals, 0);
    assert.equal(surround.scene.children.length, 0);
    assert.equal(surround.scene.background, null);
  } finally {
    surround.dispose();
    for (const texture of textures.values()) texture.dispose();
  }
});
