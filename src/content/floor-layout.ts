import { cameraContract } from '../assets/camera-contract';
import type { Bounds, Point } from './world';

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
  const bounds: Bounds = {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minZ: Math.min(...corners.map((p) => p.z)),
    maxZ: Math.max(...corners.map((p) => p.z)),
  };
  const uv = (p: Point): [number, number] => [
    (p.x * c - p.z * s) / width + 0.5,
    0.5 - (p.x * s + p.z * c) / groundDepth,
  ];
  const world = ([u, v]: readonly number[]): Point => {
    const x = (u! - 0.5) * width,
      z = (0.5 - v!) * groundDepth;
    return { x: x * c + z * s, z: -x * s + z * c };
  };
  return { corners, bounds, uv, world };
}
