import { tuning } from './gameplay';
import { polygonBounds } from './polygon';
import { cameraContract } from '../assets/camera-contract';
import type { Point } from './world';

/** Width and depth are the visible artwork dimensions, before ground foreshortening. */
export function artworkFloorLayout(width: number, depth: number) {
  const yaw = (cameraContract.azimuthDeg * Math.PI) / 180,
    elevation = (cameraContract.elevationDeg * Math.PI) / 180,
    c = Math.cos(yaw),
    s = Math.sin(yaw),
    groundDepth = depth / Math.sin(elevation);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({
    x: ((u! * width) / 2) * c + ((v! * groundDepth) / 2) * s,
    z: ((-u! * width) / 2) * s + ((v! * groundDepth) / 2) * c,
  }));
  const bounds = polygonBounds(corners);
  const uv = (p: Point): [number, number] => [
    (p.x * c - p.z * s) / width + 0.5,
    0.5 + (p.x * s + p.z * c) / groundDepth,
  ];
  const world = ([u, v]: readonly number[]): Point => {
    const x = (u! - 0.5) * width,
      z = (v! - 0.5) * groundDepth;
    return { x: x * c + z * s, z: -x * s + z * c };
  };
  // Reserve room for the complete hero and camera controls inside the painting.
  // Collision adds the actor radius to this margin, including restored positions.
  const side = Math.min(0.75, width * 0.1) / width,
    top =
      Math.min(
        cameraContract.heroHeight * tuning.heroVisualScale * Math.cos(elevation) + 0.5,
        depth * 0.6,
      ) / depth,
    bottom = Math.min(0.2, depth * 0.1) / depth,
    playableBoundary = [
      [side, top],
      [1 - side, top],
      [1 - side, 1 - bottom],
      [side, 1 - bottom],
    ].map(world);
  return { corners, bounds, uv, world, playableBoundary };
}
