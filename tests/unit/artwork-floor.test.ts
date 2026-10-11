import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import { boundaryContains, clampToBoundary, supportedPosition } from '../../src/content/world';
import { cameraContract } from '../../src/assets/camera-contract';

test('single paintings cover one complete image and retain the displayed aspect ratio', () => {
  const layout = artworkFloorLayout(6, 4),
    yaw = (cameraContract.azimuthDeg * Math.PI) / 180,
    elevation = (cameraContract.elevationDeg * Math.PI) / 180;
  const projected = layout.corners.map((p) => ({
    x: p.x * Math.cos(yaw) - p.z * Math.sin(yaw),
    y: (p.x * Math.sin(yaw) + p.z * Math.cos(yaw)) * Math.sin(elevation),
  }));
  const width = Math.max(...projected.map((p) => p.x)) - Math.min(...projected.map((p) => p.x));
  const height = Math.max(...projected.map((p) => p.y)) - Math.min(...projected.map((p) => p.y));
  assert.ok(Math.abs(width / height - 1.5) < 1e-10);
  for (const [i, p] of layout.corners.entries()) {
    const [u, v] = layout.uv(p),
      expected = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ][i]!;
    assert.ok(Math.abs(u - expected[0]!) < 1e-10 && Math.abs(v - expected[1]!) < 1e-10);
  }
  for (const p of [
    { x: 100, z: 100 },
    { x: -100, z: 40 },
    { x: 30, z: -80 },
  ]) {
    const supported = clampToBoundary(layout.corners, p, 0.3);
    assert.ok(boundaryContains(layout.corners, supported, 0.3));
  }
});

import { Vector3 } from 'three';
import {
  constrainCamera,
  makeCamera,
  resizeCamera,
  outward,
  groundPoint,
} from '../../src/core/camera';
import { resolveScene } from '../../src/content/world-art';
import { emptyScene } from '../../src/editor/default-scene';

test('camera keeps all four viewport corners on the floor at every edge, aspect and zoom', () => {
  for (const layout of [undefined, 'artwork'] as const) {
    const document = emptyScene();
    document.floor.layout = layout;
    document.floor.width = 6;
    document.floor.depth = 4;
    const { area } = resolveScene(document);
    for (const [width, height] of [
      [1600, 900],
      [900, 1600],
      [3000, 500],
    ])
      for (const span of [2, 9, 30])
        for (const p of [{ x: 0, z: 0 }, ...artworkFloorLayout(6, 4).corners]) {
          const hero = supportedPosition(area, p, 0.3),
            target = new Vector3(hero.x, 1.7, hero.z),
            camera = makeCamera(width! / height!);
          resizeCamera(camera, width!, height!, span);
          constrainCamera(camera, target, area);
          camera.position.copy(target).addScaledVector(outward, 30);
          camera.lookAt(target);
          camera.updateMatrixWorld();
          for (const x of [0, width!])
            for (const y of [0, height!]) {
              const corner = groundPoint(camera, x, y, {
                left: 0,
                top: 0,
                width: width!,
                height: height!,
              })!;
              assert.ok(corner);
              corner.addScaledVector(outward, -0.01 / outward.y);
              assert.ok(corner.x >= area.bounds.minX - 1e-8 && corner.x <= area.bounds.maxX + 1e-8);
              assert.ok(corner.z >= area.bounds.minZ - 1e-8 && corner.z <= area.bounds.maxZ + 1e-8);
              if (area.playableBoundary) assert.ok(boundaryContains(area.playableBoundary, corner));
            }
          // Moving away from a small floor must release its temporary zoom constraint.
          resizeCamera(camera, width!, height!, 0.5);
          constrainCamera(camera, target, area);
          assert.equal(camera.zoom, 1);
        }
  }
});
