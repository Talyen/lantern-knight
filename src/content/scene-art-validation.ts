import { sceneFixtures } from './scenery-presets';
import type { Bounds, Point } from './world';
import type { ArtPlacement, WorldVisualDefinition, SiteWall } from './world-visuals';
export type ArtFinding = {
  kind: 'solid-intersection' | 'invalid-registration' | 'blocked-route' | 'unknown-allowance';
  a: string;
  b?: string;
  message: string;
};
type Solid = {
  id: string;
  center: Point;
  width: number;
  length: number;
  angle: number;
  wall?: SiteWall;
};
function corners(s: Solid) {
  const c = Math.cos(s.angle),
    n = Math.sin(s.angle);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => ({
    x: s.center.x + ((x! * s.width) / 2) * c - ((z! * s.length) / 2) * n,
    z: s.center.z + ((x! * s.width) / 2) * n + ((z! * s.length) / 2) * c,
  }));
}
export function solidIntersection(a: Solid, b: Solid): Bounds | undefined {
  const ac = corners(a),
    bc = corners(b),
    axes = [a.angle, b.angle].flatMap((t) => [
      { x: Math.cos(t), z: Math.sin(t) },
      { x: -Math.sin(t), z: Math.cos(t) },
    ]);
  for (const axis of axes) {
    const aa = ac.map((p) => p.x * axis.x + p.z * axis.z),
      bb = bc.map((p) => p.x * axis.x + p.z * axis.z);
    if (
      Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)) <
      0.001
    )
      return undefined;
  }
  let polygon = ac;
  // Compute the actual intersection polygon; overlapping bounding boxes can extend far
  // beyond a short butt join when retaining edges run diagonally.
  const cross = (a: Point, b: Point, p: Point) =>
    (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  for (let k = 0; k < bc.length; k++) {
    const u = bc[k]!,
      v = bc[(k + 1) % bc.length]!,
      input = polygon;
    polygon = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!,
        q = input[(i + 1) % input.length]!,
        cp = cross(u, v, p),
        cq = cross(u, v, q),
        pin = cp >= -1e-9,
        qin = cq >= -1e-9;
      if (pin) polygon.push(p);
      if (pin !== qin) {
        const t = cp / (cp - cq);
        polygon.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
      }
    }
  }
  if (!polygon.length) return undefined;
  return {
    minX: Math.min(...polygon.map((p) => p.x)),
    maxX: Math.max(...polygon.map((p) => p.x)),
    minZ: Math.min(...polygon.map((p) => p.z)),
    maxZ: Math.max(...polygon.map((p) => p.z)),
  };
}
const within = (region: Bounds, point: Point) =>
  point.x >= region.minX &&
  point.x <= region.maxX &&
  point.z >= region.minZ &&
  point.z <= region.maxZ;
export function sceneArtFindings(art: WorldVisualDefinition): ArtFinding[] {
  const findings: ArtFinding[] = [],
    ids = new Set<string>();
  for (const p of [...art.props, ...art.walls]) {
    if (ids.has(p.id))
      findings.push({ kind: 'invalid-registration', a: p.id, message: 'Duplicate placement ID' });
    ids.add(p.id);
  }
  for (const allowance of art.overlaps ?? [])
    if (
      !ids.has(allowance.a) ||
      !ids.has(allowance.b) ||
      !allowance.reason ||
      allowance.region.minX >= allowance.region.maxX ||
      allowance.region.minZ >= allowance.region.maxZ
    )
      findings.push({
        kind: 'unknown-allowance',
        a: allowance.a,
        b: allowance.b,
        message: 'Overlap allowance must name real placements and a local nonempty region',
      });
  for (const route of art.paths)
    if (
      route.widths &&
      (route.widths.length !== route.points.length ||
        route.widths.some((w) => !Number.isFinite(w) || w <= 0))
    )
      findings.push({
        kind: 'invalid-registration',
        a: 'path',
        message: 'Route width is registered at every control point',
      });
  for (const g of art.graves)
    if (!Number.isFinite(g.width + g.length + (g.angle ?? 0)) || g.width <= 0 || g.length <= 0)
      findings.push({
        kind: 'invalid-registration',
        a: g.id,
        message: 'Burial dimensions and axis must be finite and positive',
      });
  const solids: Solid[] = [
    ...art.props
      .filter((p): p is ArtPlacement & { footprint: readonly [number, number] } => !!p.footprint)
      .map((p) => ({
        id: p.id,
        center: { x: p.x, z: p.z },
        width: p.footprint[0],
        length: p.footprint[1],
        angle: p.footprintAngle ?? 0,
      })),
    ...art.walls.map((w) => ({
      id: w.id,
      center: { x: (w.from.x + w.to.x) / 2, z: (w.from.z + w.to.z) / 2 },
      width: Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z),
      length: w.thickness,
      angle: Math.atan2(w.to.z - w.from.z, w.to.x - w.from.x),
      wall: w,
    })),
  ];
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i]!,
        b = solids[j]!,
        hit = solidIntersection(a, b);
      if (!hit) continue;
      if (a.wall && b.wall) {
        const joined = [a.wall.from, a.wall.to].find((p) =>
          [b.wall!.from, b.wall!.to].some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.001),
        );
        if (
          joined &&
          Math.max(
            Math.abs(hit.minX - joined.x),
            Math.abs(hit.maxX - joined.x),
            Math.abs(hit.minZ - joined.z),
            Math.abs(hit.maxZ - joined.z),
          ) <=
            Math.max(a.wall.thickness, b.wall.thickness) + 0.001
        )
          continue;
      }
      const allowance = art.overlaps?.find(
        (v) =>
          ((v.a === a.id && v.b === b.id) || (v.a === b.id && v.b === a.id)) &&
          within(v.region, { x: hit.minX, z: hit.minZ }) &&
          within(v.region, { x: hit.maxX, z: hit.maxZ }),
      );
      if (allowance) continue;
      findings.push({
        kind: 'solid-intersection',
        a: a.id,
        b: b.id,
        message: 'Solid footprints overlap outside a registered join/attachment region',
      });
    }
  for (const fixture of sceneFixtures(art))
    if (
      !art.props.some((p) => p.id === fixture.prop) ||
      !fixture.socket.every(Number.isFinite) ||
      fixture.power <= 0 ||
      fixture.radius <= 0
    )
      findings.push({
        kind: 'invalid-registration',
        a: fixture.id,
        message: 'Fixture needs a parent, socket, positive light range and power',
      });
  return findings;
}
