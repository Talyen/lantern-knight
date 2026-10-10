import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import { boundaryContains, clampToBoundary } from '../../src/content/world';
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
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
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
