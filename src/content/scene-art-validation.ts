import { clipPolygon, polygonBounds, rotatedRectCorners } from './polygon';
import { contains } from './collision';
import { placementOffset, sceneFixtures } from './scenery-presets';
import type { Bounds, Point } from './world';
import type { ArtPlacement, WorldVisualDefinition, SiteWall } from './world-visuals';
export type ArtFinding = {
  kind: 'solid-intersection' | 'invalid-registration' | 'unknown-allowance';
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
  return rotatedRectCorners(s.center, s.width, s.length, s.angle);
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
  const polygon = clipPolygon(ac, bc, 1e-9);
  return polygon.length ? polygonBounds(polygon) : undefined;
}
export function sceneArtFindings(art: WorldVisualDefinition): ArtFinding[] {
  const findings: ArtFinding[] = [],
    ids = new Set<string>();
  for (const p of [...art.props, ...art.walls]) {
    if (ids.has(p.id))
      findings.push({ kind: 'invalid-registration', a: p.id, message: 'Duplicate placement ID' });
    ids.add(p.id);
  }
  const byId = new Map<string, (typeof art.props)[number]>();
  for (const s of art.props) if (!byId.has(s.id)) byId.set(s.id, s);
  for (const p of art.props) {
    if (!p.mount) continue;
    const support = byId.get(p.mount.to);
    const [x, y, z] = placementOffset(support ?? {}, p.mount.offset);
    if (
      !support ||
      Math.hypot(p.x - support.x - x, p.z - support.z - z) > 1e-6 ||
      Math.abs((p.y ?? 0) - (support.y ?? 0) - y) > 1e-6
    )
      findings.push({
        kind: 'invalid-registration',
        a: p.id,
        message: 'Attachment mount differs from its support socket',
      });
  }
  for (const allowance of art.overlaps ?? [])
    if (
      allowance.a === allowance.b ||
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
      .filter(
        (p): p is ArtPlacement & { footprint: readonly [number, number] } =>
          !!p.footprint && p.role !== 'attachment',
      )
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
  const overlapsByPair = new Map<string, Array<NonNullable<typeof art.overlaps>[number]>>();
  for (const v of art.overlaps ?? []) {
    for (const key of [v.a + '|' + v.b, v.b + '|' + v.a]) {
      const list = overlapsByPair.get(key);
      if (list) list.push(v);
      else overlapsByPair.set(key, [v]);
    }
  }
  const propIds = new Set(art.props.map((p) => p.id));
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
      const allowance = overlapsByPair
        .get(a.id + '|' + b.id)
        ?.find(
          (v) =>
            contains(v.region, { x: hit.minX, z: hit.minZ }) &&
            contains(v.region, { x: hit.maxX, z: hit.maxZ }),
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
      !propIds.has(fixture.prop) ||
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
