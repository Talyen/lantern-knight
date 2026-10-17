import {
  isSupportedPosition,
  supportedPosition,
  clearSegment,
  sweepCircle,
} from '../content/collision';
import type { AreaDefinition, Point } from '../content/world';
export { effectiveRadius, clearSegment } from '../content/collision';
const epsilon = 1e-6;
export function moveSupported(
  area: AreaDefinition,
  start: Point,
  delta: Point,
  radius: number,
): Point {
  let p = isSupportedPosition(area, start, radius)
      ? { x: start.x, z: start.z }
      : supportedPosition(area, start, radius),
    d = { ...delta };
  if (d.x === 0 && d.z === 0) return p;
  for (let i = 0; i < 4; i++) {
    const hit = sweepCircle(area, p, d, radius);
    if (!hit) {
      const next = { x: p.x + d.x, z: p.z + d.z };
      return isSupportedPosition(area, next, radius) ? next : p;
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
// Extra room policy belongs to its gameplay owner; all route phases use it.
export interface TraversalPolicy {
  position(point: Point): boolean;
  segment(start: Point, end: Point): boolean;
}
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
  readonly #policy: TraversalPolicy | undefined;
  constructor(
    readonly area: AreaDefinition,
    policy?: TraversalPolicy,
  ) {
    this.#policy = policy;
  }
  clear(start: Point, end: Point, radius: number) {
    return (
      clearSegment(this.area, start, end, radius) && (this.#policy?.segment(start, end) ?? true)
    );
  }
  route(start: Point, goal: Point, radius: number): RouteResult {
    const fail: RouteResult = { status: 'unreachable', points: [] };
    if (
      !isSupportedPosition(this.area, start, radius) ||
      !isSupportedPosition(this.area, goal, radius) ||
      this.#policy?.position(goal) === false
    )
      return fail;
    if (this.clear(start, goal, radius)) return { status: 'ready', points: [{ ...goal }] };
    const b = this.area.bounds,
      nx = Math.ceil((b.maxX - b.minX) / this.spacing) + 1,
      nz = Math.ceil((b.maxZ - b.minZ) / this.spacing) + 1,
      destination = nx * nz;
    let cells = this.grids.get(radius);
    if (!cells) {
      cells = new Map();
      this.grids.set(radius, cells);
    }
    const point = (id: number): Point =>
      id === destination
        ? goal
        : {
            x: b.minX + (id % nx) * this.spacing,
            z: b.minZ + Math.floor(id / nx) * this.spacing,
          };
    const valid = (id: number) => {
      if (id < 0 || id >= nx * nz) return false;
      let v = cells!.get(id);
      if (v === undefined) {
        v =
          isSupportedPosition(this.area, point(id), radius) &&
          (this.#policy?.position(point(id)) ?? true);
        cells!.set(id, v);
      }
      return v;
    };
    const connections = (p: Point) => {
      const ix = Math.round((p.x - b.minX) / this.spacing),
        iz = Math.round((p.z - b.minZ) / this.spacing);
      // A saved actor may start within a newly authored forbidden region. Find
      // an admissible outward connection instead of trapping it at that point.
      const limit = this.#policy?.position(p) === false ? Math.max(nx, nz) : 4;
      const found: number[] = [];
      for (let r = 0; r <= limit; r++) {
        for (let z = iz - r; z <= iz + r; z++)
          for (let x = ix - r; x <= ix + r; x++) {
            if (r && x !== ix - r && x !== ix + r && z !== iz - r && z !== iz + r) continue;
            if (x < 0 || x >= nx || z < 0 || z >= nz) continue;
            const id = z * nx + x;
            if (valid(id) && this.clear(p, point(id), radius)) found.push(id);
          }
        // A nearest node can belong to a disconnected pocket. Keep every
        // local connection; forbidden starts search outward until they escape.
        if (found.length && r >= 4) break;
      }
      return found;
    };
    const from = connections(start);
    if (!from.length) return fail;
    const heap = new Heap(),
      scores = new Map<number, number>(),
      parents = new Map<number, number>(),
      closed = new Set<number>();
    const h = (id: number) => {
      const p = point(id),
        g = goal;
      return Math.hypot(p.x - g.x, p.z - g.z);
    };
    for (const id of from) {
      const p = point(id),
        cost = Math.hypot(p.x - start.x, p.z - start.z);
      scores.set(id, cost);
      heap.push(id, cost + h(id));
    }
    while (heap.entries.length) {
      const current = heap.pop()!.id;
      if (closed.has(current)) continue;
      if (current === destination) {
        const raw: Point[] = [{ ...goal }];
        let id = parents.get(destination);
        while (id !== undefined) {
          raw.push(point(id));
          id = parents.get(id);
        }
        raw.reverse();
        const smooth: Point[] = [];
        let origin = start;
        for (let i = 0; i < raw.length;) {
          let j = raw.length - 1;
          while (j > i && !this.clear(origin, raw[j]!, radius)) j--;
          smooth.push(raw[j]!);
          origin = raw[j]!;
          i = j + 1;
        }
        return { status: 'ready', points: smooth };
      }
      closed.add(current);
      // Connect the actual endpoint wherever it becomes visible. A narrow
      // recess may have no connected grid cell beside its goal.
      if (this.clear(point(current), goal, radius)) {
        const cost = scores.get(current)! + h(current);
        if (cost < (scores.get(destination) ?? Infinity)) {
          scores.set(destination, cost);
          parents.set(destination, current);
          heap.push(destination, cost);
        }
        continue;
      }
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
          if (!this.clear(point(current), point(next), radius)) continue;
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
