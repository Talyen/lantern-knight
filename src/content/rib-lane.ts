import { cameraContract } from '../assets/camera-contract';
import type { AttackDefinition, Point } from './world';

export const ribLaneAttack = {
  kind: 'rib-lane',
  windup: 61,
  activeEnd: 67,
  total: 92,
  range: 6,
  length: 4,
  width: 0.8,
  damage: 14,
  cooldown: 180,
} as const satisfies AttackDefinition;

// The supplied lane runs from (18%,72%) to (80%,42%) on a 512x384 cel.
// Invert the locked camera's ground projection; never rotate the painted effect.
const azimuth = (cameraContract.azimuthDeg * Math.PI) / 180;
const elevation = (cameraContract.elevationDeg * Math.PI) / 180;
const horizontal = 0.62 * 512;
const depth = (0.3 * 384) / Math.sin(elevation);
const x = horizontal * Math.cos(azimuth) - depth * Math.sin(azimuth);
const z = -horizontal * Math.sin(azimuth) - depth * Math.cos(azimuth);
const ribLaneAxis = Object.freeze({ x: x / Math.hypot(x, z), z: z / Math.hypot(x, z) });
export const ribLaneArtwork = Object.freeze({
  worldLength: Math.hypot(x, z) / 256,
  // Supplied guide midpoint relative to the prepared canvas anchor, in pixels.
  centerOffset: { x: (0.49 * 512 - 256) / 256, y: (192 - 0.57 * 384) / 256 },
});

export type RibLane = Readonly<
  Point & {
    id: string;
    source: string;
    y: number;
    age: number;
    length: number;
    width: number;
    windup: number;
    total: number;
  }
>;

export function lanePoint(center: Point, along: number, across: number): Point {
  return {
    x: center.x + ribLaneAxis.x * along - ribLaneAxis.z * across,
    z: center.z + ribLaneAxis.z * along + ribLaneAxis.x * across,
  };
}
export function nearestLanePoint(
  lane: Pick<RibLane, 'x' | 'z' | 'length' | 'width'>,
  point: Point,
) {
  const dx = point.x - lane.x,
    dz = point.z - lane.z;
  const along = Math.max(
    -lane.length / 2,
    Math.min(lane.length / 2, dx * ribLaneAxis.x + dz * ribLaneAxis.z),
  );
  const across = Math.max(
    -lane.width / 2,
    Math.min(lane.width / 2, -dx * ribLaneAxis.z + dz * ribLaneAxis.x),
  );
  return lanePoint(lane, along, across);
}
