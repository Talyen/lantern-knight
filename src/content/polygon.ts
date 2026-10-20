import type { Bounds, Point } from './world';

const cross = (a: Point, b: Point, p: Point) =>
  (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
export function polygonArea(points: readonly Point[]) {
  return (
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return sum + p.x * q.z - p.z * q.x;
    }, 0) / 2
  );
}
export function polygonBounds(points: readonly Point[]): Bounds {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}
export function insidePolygon(p: Point, points: readonly Point[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!,
      b = points[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x)
      inside = !inside;
  }
  return inside;
}
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  return (
    Math.max(a.x, b.x) >= Math.min(c.x, d.x) &&
    Math.max(c.x, d.x) >= Math.min(a.x, b.x) &&
    Math.max(a.z, b.z) >= Math.min(c.z, d.z) &&
    Math.max(c.z, d.z) >= Math.min(a.z, b.z) &&
    cross(a, b, c) * cross(a, b, d) <= 0 &&
    cross(c, d, a) * cross(c, d, b) <= 0
  );
}
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
  );
  return { x: a.x + dx * t, z: a.z + dz * t };
}
export function polygonEdgeDistance(point: Point, ring: readonly Point[]) {
  let distance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const nearest = closestPointOnSegment(point, ring[i]!, ring[(i + 1) % ring.length]!);
    distance = Math.min(distance, Math.hypot(point.x - nearest.x, point.z - nearest.z));
  }
  return distance;
}

/** Clip a polygon against a convex boundary of either winding. Keeps boundary contacts. */
export function clipPolygon(
  subject: readonly Point[],
  boundary: readonly Point[],
  epsilon = 1e-10,
): Point[] {
  if (boundary.length < 3) return [];
  const area = polygonArea(boundary);
  if (!Number.isFinite(area) || area === 0) return [];
  let polygon = [...subject];
  const sign = Math.sign(area);
  for (let edge = 0; edge < boundary.length; edge++) {
    const a = boundary[edge]!,
      b = boundary[(edge + 1) % boundary.length]!,
      input = polygon;
    polygon = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!,
        q = input[(i + 1) % input.length]!;
      const cp = cross(a, b, p) * sign,
        cq = cross(a, b, q) * sign;
      if (cp >= -epsilon) polygon.push(p);
      if (cp >= -epsilon !== cq >= -epsilon) {
        const t = cp / (cp - cq);
        polygon.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  return polygon;
}

export function boundsCorners(b: Bounds): Point[] {
  return [
    { x: b.minX, z: b.minZ },
    { x: b.maxX, z: b.minZ },
    { x: b.maxX, z: b.maxZ },
    { x: b.minX, z: b.maxZ },
  ];
}
export function rotatedRectCorners(
  center: Point,
  width: number,
  length: number,
  angle: number,
): Point[] {
  const c = Math.cos(angle),
    n = Math.sin(angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => ({
    x: center.x + ((x! * width) / 2) * c - ((z! * length) / 2) * n,
    z: center.z + ((x! * width) / 2) * n + ((z! * length) / 2) * c,
  }));
}
