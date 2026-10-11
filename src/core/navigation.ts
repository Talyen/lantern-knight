import { insidePolygon } from '../content/graveyard-layout';
import {
  boundaryContains,
  type AreaDefinition,
  type Point,
  type PropDefinition,
} from '../content/world';
export const effectiveRadius = (radius: number) => Math.max(0.3, radius);
type Hit = { t: number; nx: number; nz: number };
const epsilon = 1e-6;
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
type Shape = { points?: readonly Point[]; minX: number; maxX: number; minZ: number; maxZ: number };
const shapes = new WeakMap<PropDefinition, Shape>();
function shape(p: PropDefinition): Shape {
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
  shapes.set(p, cached);
  return cached;
}
function positionClear(area: AreaDefinition, p: Point, radius: number) {
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
    const s = shape(prop);
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
/** Earliest circle/segment contact along a displacement, with inward motion only. */
function sweep(area: AreaDefinition, start: Point, delta: Point, radius: number): Hit | undefined {
  let best: Hit | undefined;
  const accept = (t: number, nx: number, nz: number) => {
    if (t >= -epsilon && t <= 1 && nx * delta.x + nz * delta.z < -epsilon && (!best || t < best.t))
      best = { t: Math.max(0, t), nx, nz };
  };
  const circle = (p: Point, r: number) => {
    const x = start.x - p.x,
      z = start.z - p.z,
      a = delta.x * delta.x + delta.z * delta.z;
    if (a < epsilon * epsilon) return;
    const b = x * delta.x + z * delta.z,
      c = x * x + z * z - r * r,
      disc = b * b - a * c;
    if (disc < 0) return;
    const t = (-b - Math.sqrt(disc)) / a,
      qx = x + delta.x * t,
      qz = z + delta.z * t,
      len = Math.hypot(qx, qz);
    if (len > epsilon) accept(t, qx / len, qz / len);
  };
  const edge = (a: Point, b: Point) => {
    const dx = b.x - a.x,
      dz = b.z - a.z,
      len = Math.hypot(dx, dz);
    if (len < epsilon) return;
    const nx = -dz / len,
      nz = dx / len,
      d = (start.x - a.x) * nx + (start.z - a.z) * nz,
      v = delta.x * nx + delta.z * nz;
    for (const sign of [-1, 1]) {
      if (Math.abs(v) < epsilon) continue;
      const t = (sign * radius - d) / v,
        qx = start.x + delta.x * t - a.x,
        qz = start.z + delta.z * t - a.z,
        u = (qx * dx + qz * dz) / (len * len);
      if (u >= 0 && u <= 1) accept(t, nx * sign, nz * sign);
    }
    circle(a, radius);
    circle(b, radius);
  };
  const bounds = area.bounds,
    boundary = area.playableBoundary ?? [
      { x: bounds.minX, z: bounds.minZ },
      { x: bounds.maxX, z: bounds.minZ },
      { x: bounds.maxX, z: bounds.maxZ },
      { x: bounds.minX, z: bounds.maxZ },
    ];
  for (let i = 0; i < boundary.length; i++)
    edge(boundary[i]!, boundary[(i + 1) % boundary.length]!);
  for (const p of area.props) {
    if (p.blocking === false) continue;
    const cached = shape(p);
    if (
      Math.max(start.x, start.x + delta.x) < cached.minX - radius ||
      Math.min(start.x, start.x + delta.x) > cached.maxX + radius ||
      Math.max(start.z, start.z + delta.z) < cached.minZ - radius ||
      Math.min(start.z, start.z + delta.z) > cached.maxZ + radius
    )
      continue;
    const points = cached.points;
    if (points)
      for (let i = 0; i < points.length; i++) edge(points[i]!, points[(i + 1) % points.length]!);
    else circle(p, p.radius + radius);
  }
  return best;
}
export function clearSegment(area: AreaDefinition, a: Point, b: Point, radius: number) {
  return (
    positionClear(area, a, radius) &&
    positionClear(area, b, radius) &&
    !sweep(area, a, { x: b.x - a.x, z: b.z - a.z }, radius)
  );
}
export function moveSupported(
  area: AreaDefinition,
  start: Point,
  delta: Point,
  radius: number,
): Point {
  let p = { x: start.x, z: start.z },
    d = { ...delta };
  for (let i = 0; i < 4; i++) {
    const hit = sweep(area, p, d, radius);
    if (!hit) {
      const next = { x: p.x + d.x, z: p.z + d.z };
      return positionClear(area, next, radius) ? next : p;
    }
    const t = Math.max(0, hit.t - epsilon / Math.max(epsilon, Math.hypot(d.x, d.z)));
    p = { x: p.x + d.x * t, z: p.z + d.z * t };
    d = { x: d.x * (1 - t), z: d.z * (1 - t) };
    const inward = Math.min(0, d.x * hit.nx + d.z * hit.nz);
    d.x -= inward * hit.nx;
    d.z -= inward * hit.nz;
    if (Math.hypot(d.x, d.z) < epsilon) break;
  }
  return p;
}
export type RouteResult =
  { status: 'ready'; points: Point[] } | { status: 'unreachable'; points: [] };
class Heap {
  entries: { id: number; score: number }[] = [];
  push(id: number, score: number) {
    const value = { id, score };
    let i = this.entries.length;
    this.entries.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.entries[p]!.score <= score) break;
      this.entries[i] = this.entries[p]!;
      i = p;
    }
    this.entries[i] = value;
  }
  pop() {
    const first = this.entries[0],
      last = this.entries.pop();
    if (this.entries.length && last) {
      let i = 0;
      while (i * 2 + 1 < this.entries.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.entries.length && this.entries[c + 1]!.score < this.entries[c]!.score) c++;
        if (last.score <= this.entries[c]!.score) break;
        this.entries[i] = this.entries[c]!;
        i = c;
      }
      this.entries[i] = last;
    }
    return first;
  }
}
/** Lazily evaluates a fixed grid; immutable area identity owns all cached clearance. */
export class Navigation {
  readonly spacing = 0.2;
  private grids = new Map<number, Map<number, boolean>>();
  constructor(readonly area: AreaDefinition) {}
  route(start: Point, goal: Point, radius: number): RouteResult {
    const fail: RouteResult = { status: 'unreachable', points: [] };
    if (!positionClear(this.area, start, radius) || !positionClear(this.area, goal, radius))
      return fail;
    if (clearSegment(this.area, start, goal, radius))
      return { status: 'ready', points: [{ ...goal }] };
    const b = this.area.bounds,
      nx = Math.ceil((b.maxX - b.minX) / this.spacing) + 1,
      nz = Math.ceil((b.maxZ - b.minZ) / this.spacing) + 1;
    let cells = this.grids.get(radius);
    if (!cells) {
      cells = new Map();
      this.grids.set(radius, cells);
    }
    const point = (id: number): Point => ({
      x: b.minX + (id % nx) * this.spacing,
      z: b.minZ + Math.floor(id / nx) * this.spacing,
    });
    const valid = (id: number) => {
      if (id < 0 || id >= nx * nz) return false;
      let v = cells!.get(id);
      if (v === undefined) {
        v = positionClear(this.area, point(id), radius);
        cells!.set(id, v);
      }
      return v;
    };
    const nearest = (p: Point) => {
      const ix = Math.round((p.x - b.minX) / this.spacing),
        iz = Math.round((p.z - b.minZ) / this.spacing);
      for (let r = 0; r <= 4; r++) {
        const found: number[] = [];
        for (let z = iz - r; z <= iz + r; z++)
          for (let x = ix - r; x <= ix + r; x++) {
            if (x < 0 || x >= nx || z < 0 || z >= nz) continue;
            const id = z * nx + x;
            if (valid(id) && clearSegment(this.area, p, point(id), radius)) found.push(id);
          }
        if (found.length)
          return found.sort(
            (a, c) =>
              Math.hypot(point(a).x - p.x, point(a).z - p.z) -
              Math.hypot(point(c).x - p.x, point(c).z - p.z),
          )[0];
      }
    };
    const from = nearest(start),
      to = nearest(goal);
    if (from === undefined || to === undefined) return fail;
    const heap = new Heap(),
      scores = new Map<number, number>([[from, 0]]),
      parents = new Map<number, number>(),
      closed = new Set<number>();
    const h = (id: number) => {
      const p = point(id),
        g = point(to);
      return Math.hypot(p.x - g.x, p.z - g.z);
    };
    heap.push(from, h(from));
    while (heap.entries.length) {
      const current = heap.pop()!.id;
      if (closed.has(current)) continue;
      if (current === to) {
        const raw: Point[] = [{ ...goal }];
        let id = to;
        while (id !== from) {
          raw.push(point(id));
          id = parents.get(id)!;
        }
        raw.push(point(from));
        raw.reverse();
        const smooth: Point[] = [];
        let origin = start;
        for (let i = 0; i < raw.length;) {
          let j = raw.length - 1;
          while (j > i && !clearSegment(this.area, origin, raw[j]!, radius)) j--;
          smooth.push(raw[j]!);
          origin = raw[j]!;
          i = j + 1;
        }
        return { status: 'ready', points: smooth };
      }
      closed.add(current);
      const x = current % nx,
        z = Math.floor(current / nx);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dz === 0) || x + dx < 0 || x + dx >= nx || z + dz < 0 || z + dz >= nz)
            continue;
          const next = current + dx + dz * nx;
          if (
            closed.has(next) ||
            !valid(next) ||
            (dx && dz && (!valid(current + dx) || !valid(current + dz * nx)))
          )
            continue;
          if (!clearSegment(this.area, point(current), point(next), radius)) continue;
          const cost = scores.get(current)! + Math.hypot(dx, dz) * this.spacing;
          if (cost >= (scores.get(next) ?? Infinity)) continue;
          scores.set(next, cost);
          parents.set(next, current);
          heap.push(next, cost + h(next));
        }
    }
    return fail;
  }
  debugCells(radius: number) {
    const b = this.area.bounds,
      nx = Math.ceil((b.maxX - b.minX) / this.spacing) + 1;
    return [...(this.grids.get(radius) ?? [])].map(([id, walkable]) => ({
      x: b.minX + (id % nx) * this.spacing,
      z: b.minZ + Math.floor(id / nx) * this.spacing,
      walkable,
    }));
  }
}
