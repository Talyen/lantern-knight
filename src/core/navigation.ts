import {
  isSupportedPosition,
  supportedPosition,
  clearSegment,
  sweepCircle,
} from '../content/collision';
import type { AreaDefinition, Point } from '../content/world';
const epsilon = 1e-6;
export function moveSupported(
  area: AreaDefinition,
  start: Point,
  delta: Point,
  radius: number,
): Point {
  // The returned point is only read; an uninterrupted move borrows the start
  // instead of copying it on every per-tick call.
  let p = isSupportedPosition(area, start, radius) ? start : supportedPosition(area, start, radius);
  const fallback = p;
  if (delta.x === 0 && delta.z === 0) return { ...p };
  let dx = delta.x,
    dz = delta.z;
  for (let i = 0; i < 4; i++) {
    const step = { x: dx, z: dz };
    const hit = sweepCircle(area, p, step, radius);
    if (!hit) {
      const next = { x: p.x + dx, z: p.z + dz };
      return isSupportedPosition(area, next, radius) ? next : p;
    }
    const t = Math.max(0, hit.t - epsilon / Math.max(epsilon, Math.hypot(dx, dz)));
    p = { x: p.x + dx * t, z: p.z + dz * t };
    dx *= 1 - t;
    dz *= 1 - t;
    const inward = Math.min(0, dx * hit.nx + dz * hit.nz);
    dx -= inward * hit.nx;
    dz -= inward * hit.nz;
    if (dx * dx + dz * dz < epsilon * epsilon) break;
  }
  // Sliding around concave corners can still end marginally inside geometry.
  // Mirror the no-contact branch: never return a worse position than the start.
  return isSupportedPosition(area, p, radius) ? p : fallback;
}
export type RouteResult =
  { status: 'ready'; points: Point[] } | { status: 'unreachable'; points: [] };
// Extra room policy belongs to its gameplay owner; all route phases use it.
export interface TraversalPolicy {
  position(point: Point): boolean;
  segment(start: Point, end: Point): boolean;
}
class Heap {
  private entries: { id: number; score: number }[] = [];
  get size() {
    return this.entries.length;
  }
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
  pop(): { id: number; score: number } | undefined {
    const first = this.entries[0];
    if (!first) return undefined;
    const last = this.entries.pop()!;
    if (this.entries.length) {
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
  private edges = new Map<number, Map<number, number>>();
  private readonly immutableGeometry: boolean;
  readonly #policy: TraversalPolicy | undefined;
  constructor(
    readonly area: AreaDefinition,
    policy?: TraversalPolicy,
  ) {
    this.#policy = policy;
    const frozenPoints = (points: readonly Point[] | undefined) =>
      !points || (Object.isFrozen(points) && points.every(Object.isFrozen));
    this.immutableGeometry =
      Object.isFrozen(area) &&
      Object.isFrozen(area.bounds) &&
      Object.isFrozen(area.props) &&
      area.props.every(
        (p) =>
          Object.isFrozen(p) && (!p.size || Object.isFrozen(p.size)) && frozenPoints(p.polygon),
      ) &&
      frozenPoints(area.playableBoundary);
  }
  clear(start: Point, end: Point, radius: number) {
    return (
      clearSegment(this.area, start, end, radius) && (this.#policy?.segment(start, end) ?? true)
    );
  }
  private clearSupported(start: Point, end: Point, radius: number) {
    if (!this.immutableGeometry) return this.clear(start, end, radius);
    return (
      !sweepCircle(this.area, start, { x: end.x - start.x, z: end.z - start.z }, radius) &&
      (this.#policy?.segment(start, end) ?? true)
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
    if (this.clearSupported(start, goal, radius))
      return { status: 'ready', points: [{ x: goal.x, z: goal.z }] };
    const b = this.area.bounds,
      nx = Math.ceil((b.maxX - b.minX) / this.spacing) + 1,
      nz = Math.ceil((b.maxZ - b.minZ) / this.spacing) + 1,
      destination = nx * nz;
    let cells = this.grids.get(radius);
    if (!cells) {
      cells = new Map();
      this.grids.set(radius, cells);
    }
    let edges = this.edges.get(radius);
    if (!edges && this.immutableGeometry) {
      edges = new Map();
      this.edges.set(radius, edges);
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
        const at = point(id);
        v = isSupportedPosition(this.area, at, radius) && (this.#policy?.position(at) ?? true);
        cells!.set(id, v);
      }
      return v;
    };
    const connected = (from: number, to: number, dx: number, dz: number) => {
      const a = point(from),
        b = point(to);
      if (!edges) return this.clear(a, b, radius);
      const shift = ((dz + 1) * 3 + dx + 1) * 2,
        flags = edges.get(from) ?? 0,
        state = (flags >>> shift) & 3;
      // Two bits per directed neighbor: unknown, blocked, clear. Only immutable
      // grid geometry is reusable; room policy still evaluates every traversal.
      const clear = state
        ? state === 2
        : !sweepCircle(this.area, a, { x: b.x - a.x, z: b.z - a.z }, radius);
      if (!state) edges.set(from, flags | ((clear ? 2 : 1) << shift));
      return clear && (this.#policy?.segment(a, b) ?? true);
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
            if (valid(id) && this.clearSupported(p, point(id), radius)) found.push(id);
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
    while (heap.size) {
      const current = heap.pop()!.id;
      if (closed.has(current)) continue;
      if (current === destination) {
        const raw: Point[] = [{ x: goal.x, z: goal.z }];
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
          while (j > i && !this.clearSupported(origin, raw[j]!, radius)) j--;
          smooth.push(raw[j]!);
          origin = raw[j]!;
          i = j + 1;
        }
        return { status: 'ready', points: smooth };
      }
      closed.add(current);
      // Connect the actual endpoint wherever it becomes visible. A narrow
      // recess may have no connected grid cell beside its goal.
      if (this.clearSupported(point(current), goal, radius)) {
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
          if (!connected(current, next, dx, dz)) continue;
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
