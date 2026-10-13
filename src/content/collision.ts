import { insidePolygon } from './graveyard-layout';
import type { AreaDefinition, Bounds, Point, PropDefinition } from './world';
import type { ContentSnapshot } from './snapshot';

export const effectiveRadius = (radius: number) => Math.max(0.3, radius);
const epsilon = 1e-6;

export function contains(bounds: Bounds, p: Point) {
  return p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
}
// Convex boundaries use counterclockwise XZ vertices. Offset each edge inward
// by the actor radius, then project onto the resulting polygon.
export function boundaryContains(points: readonly Point[], p: Point, radius = 0) {
  return points.every((a, i) => {
    const b = points[(i + 1) % points.length]!,
      dx = b.x - a.x,
      dz = b.z - a.z;
    return (dx * (p.z - a.z) - dz * (p.x - a.x)) / Math.hypot(dx, dz) >= radius - 1e-8;
  });
}
export function clampToBoundary(points: readonly Point[], p: Point, radius: number): Point {
  if (boundaryContains(points, p, radius)) return p;
  const edges = points.map((a, i) => {
    const b = points[(i + 1) % points.length]!,
      dx = b.x - a.x,
      dz = b.z - a.z,
      length = Math.hypot(dx, dz);
    return { x: -dz / length, z: dx / length, d: (-dz * a.x + dx * a.z) / length + radius };
  });
  const inset = edges.map((b, i) => {
    const a = edges[(i + edges.length - 1) % edges.length]!,
      det = a.x * b.z - a.z * b.x;
    return { x: (a.d * b.z - a.z * b.d) / det, z: (a.x * b.d - a.d * b.x) / det };
  });
  let closest = p,
    distance = Infinity;
  for (let i = 0; i < inset.length; i++) {
    const a = inset[i]!,
      b = inset[(i + 1) % inset.length]!,
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    const q = { x: a.x + dx * t, z: a.z + dz * t },
      d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < distance) {
      closest = q;
      distance = d;
    }
  }
  return closest;
}
function vertices(p: PropDefinition): readonly Point[] | undefined {
  if (p.shape === 'polygon') return p.polygon;
  if (p.shape !== 'box' || !p.size) return;
  const c = Math.cos(p.rotation ?? 0),
    s = Math.sin(p.rotation ?? 0);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => ({
    x: p.x + ((x! * p.size![0]) / 2) * c - ((z! * p.size![1]) / 2) * s,
    z: p.z + ((x! * p.size![0]) / 2) * s + ((z! * p.size![1]) / 2) * c,
  }));
}
type Shape = ContentSnapshot<{
  points?: readonly Point[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}>;
const shapes = new WeakMap<PropDefinition, Shape>();
export function collisionShape(p: PropDefinition): Shape {
  let cached = shapes.get(p);
  if (cached) return cached;
  const points = vertices(p);
  cached = points
    ? {
        points,
        minX: Math.min(...points.map((v) => v.x)),
        maxX: Math.max(...points.map((v) => v.x)),
        minZ: Math.min(...points.map((v) => v.z)),
        maxZ: Math.max(...points.map((v) => v.z)),
      }
    : { minX: p.x - p.radius, maxX: p.x + p.radius, minZ: p.z - p.radius, maxZ: p.z + p.radius };
  if (Object.isFrozen(p)) shapes.set(p, cached);
  return cached;
}
export function isSupportedPosition(area: AreaDefinition, p: Point, radius: number) {
  const b = area.bounds;
  if (
    p.x < b.minX + radius - epsilon ||
    p.x > b.maxX - radius + epsilon ||
    p.z < b.minZ + radius - epsilon ||
    p.z > b.maxZ - radius + epsilon
  )
    return false;
  if (area.playableBoundary && !boundaryContains(area.playableBoundary, p, radius)) return false;
  for (const prop of area.props) {
    if (prop.blocking === false) continue;
    const s = collisionShape(prop);
    if (
      p.x < s.minX - radius ||
      p.x > s.maxX + radius ||
      p.z < s.minZ - radius ||
      p.z > s.maxZ + radius
    )
      continue;
    if (!s.points) {
      if (Math.hypot(p.x - prop.x, p.z - prop.z) < prop.radius + radius - epsilon) return false;
      continue;
    }
    if (insidePolygon(p, s.points)) return false;
    for (let i = 0; i < s.points.length; i++) {
      const a = s.points[i]!,
        c = s.points[(i + 1) % s.points.length]!,
        dx = c.x - a.x,
        dz = c.z - a.z,
        t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t) < radius - epsilon) return false;
    }
  }
  return true;
}
// Best-effort correction; overlapping constraints can still leave an invalid point.
// Call isSupportedPosition to validate the result.
export function supportedPosition(area: AreaDefinition, p: Point, radius: number): Point {
  let x = p.x,
    z = p.z;
  const clamp = () => {
    x = Math.max(area.bounds.minX + radius, Math.min(area.bounds.maxX - radius, x));
    z = Math.max(area.bounds.minZ + radius, Math.min(area.bounds.maxZ - radius, z));
    if (area.playableBoundary)
      ({ x, z } = clampToBoundary(area.playableBoundary, { x, z }, radius));
  };
  clamp();
  for (let pass = 0; pass < 3; pass++)
    for (const prop of area.props) {
      if (prop.blocking === false) continue;
      if (prop.shape === 'polygon' && prop.polygon) {
        const points = prop.polygon,
          inside = insidePolygon({ x, z }, points),
          signed = points.reduce((a, p, i) => {
            const q = points[(i + 1) % points.length]!;
            return a + p.x * q.z - q.x * p.z;
          }, 0),
          candidates = [];
        for (let i = 0; i < points.length; i++) {
          const a = points[i]!,
            b = points[(i + 1) % points.length]!,
            dx = b.x - a.x,
            dz = b.z - a.z,
            l = Math.hypot(dx, dz),
            t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (l * l))),
            qx = a.x + dx * t,
            qz = a.z + dz * t,
            d = Math.hypot(x - qx, z - qz),
            sign = signed < 0 ? 1 : -1;
          if (!inside && d >= radius) continue;
          const nx = inside || d < 1e-9 ? (-dz / l) * sign : (x - qx) / Math.max(d, 1e-9),
            nz = inside || d < 1e-9 ? (dx / l) * sign : (z - qz) / Math.max(d, 1e-9),
            candidate = { x: qx + nx * (radius + 0.001), z: qz + nz * (radius + 0.001) };
          if (
            candidate.x >= area.bounds.minX + radius &&
            candidate.x <= area.bounds.maxX - radius &&
            candidate.z >= area.bounds.minZ + radius &&
            candidate.z <= area.bounds.maxZ - radius &&
            !insidePolygon(candidate, points)
          )
            candidates.push({ ...candidate, d: Math.hypot(candidate.x - x, candidate.z - z) });
        }
        if (candidates.length) {
          candidates.sort((a, b) => a.d - b.d);
          x = candidates[0]!.x;
          z = candidates[0]!.z;
        }
      } else if (prop.shape === 'box' && prop.size) {
        const hx = prop.size[0] / 2,
          hz = prop.size[1] / 2,
          c = Math.cos(prop.rotation ?? 0),
          s = Math.sin(prop.rotation ?? 0),
          wx = x - prop.x,
          wz = z - prop.z,
          dx = wx * c + wz * s,
          dz = -wx * s + wz * c;
        const qx = Math.max(-hx, Math.min(hx, dx)),
          qz = Math.max(-hz, Math.min(hz, dz));
        const vx = dx - qx,
          vz = dz - qz,
          d = Math.hypot(vx, vz);
        if (d > 0 && d < radius) {
          const shift = (radius - d) / d;
          x += (vx * c - vz * s) * shift;
          z += (vx * s + vz * c) * shift;
        } else if (d === 0) {
          let lx = dx,
            lz = dz;
          if (hx - Math.abs(dx) < hz - Math.abs(dz)) lx = (dx < 0 ? -1 : 1) * (hx + radius);
          else lz = (dz < 0 ? -1 : 1) * (hz + radius);
          x = prop.x + lx * c - lz * s;
          z = prop.z + lx * s + lz * c;
        }
      } else {
        let dx = x - prop.x,
          dz = z - prop.z,
          d = Math.hypot(dx, dz),
          r = prop.radius + radius;
        if (d < r) {
          if (d < 1e-9) {
            dx = 1;
            dz = 0;
            d = 1;
          }
          x = prop.x + (dx / d) * r;
          z = prop.z + (dz / d) * r;
        }
      }
      clamp();
    }
  return { x, z };
}
