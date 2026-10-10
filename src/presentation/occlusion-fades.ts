import { Mesh, Vector3, type Material } from 'three';
import { outward, right, up, contract } from '../core/camera';
import { setCutoutOpacity } from './sprite';
import type { Simulation } from '../core/simulation';
import type { SiteWall } from '../content/world-visuals';

type Point = { x: number; y: number };
type Part = {
  mesh: Mesh;
  left: number;
  right: number;
  bottom: number;
  top: number;
  foot: Vector3;
  wall?: SiteWall;
  polygon: Point[];
};
type Group = {
  parts: Part[];
  opacity: number;
  obscured: boolean;
  from: number;
  target: number;
  elapsed: number;
  duration: number;
};
function overlaps(p: Point[], l: number, r: number, b: number, t: number) {
  if (p.some((v) => v.x >= l && v.x <= r && v.y >= b && v.y <= t)) return true;
  const corners = [
    { x: l, y: b },
    { x: r, y: b },
    { x: r, y: t },
    { x: l, y: t },
  ];
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (
    corners.some((v) => {
      const signs = p.map((a, i) => cross(a, p[(i + 1) % p.length]!, v));
      return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
    })
  )
    return true;
  for (let i = 0; i < p.length; i++)
    for (let j = 0; j < 4; j++) {
      const a = p[i]!,
        bb = p[(i + 1) % p.length]!,
        c = corners[j]!,
        d = corners[(j + 1) % 4]!;
      if (
        cross(a, bb, c) * cross(a, bb, d) <= 0 &&
        cross(c, d, a) * cross(c, d, bb) <= 0 &&
        Math.max(Math.min(a.x, bb.x), Math.min(c.x, d.x)) <=
          Math.min(Math.max(a.x, bb.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, bb.y), Math.min(c.y, d.y)) <=
          Math.min(Math.max(a.y, bb.y), Math.max(c.y, d.y))
      )
        return true;
    }
  return false;
}
// The camera translates without rotating, so static projected bounds are cached once.
export class OcclusionFades {
  readonly groups = new Map<string, Group>();
  add(mesh: Mesh, group = mesh.uuid, wall?: SiteWall) {
    mesh.updateMatrixWorld(true);
    const vertices = mesh.geometry.getAttribute('position');
    const part: Part = {
      mesh,
      left: Infinity,
      right: -Infinity,
      bottom: Infinity,
      top: -Infinity,
      foot: mesh.position.clone(),
      wall,
      polygon: [],
    };
    const projected: Point[] = [];
    for (let i = 0; i < vertices.count; i++) {
      const v = new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld),
        x = v.dot(right),
        y = v.dot(up);
      projected.push({ x, y });
      part.left = Math.min(part.left, x);
      part.right = Math.max(part.right, x);
      part.bottom = Math.min(part.bottom, y);
      part.top = Math.max(part.top, y);
    }
    part.polygon = [0, 1, 3, 2].map((i) => projected[i]!);
    let entry = this.groups.get(group);
    if (!entry) {
      entry = {
        parts: [],
        opacity: 1,
        obscured: false,
        from: 1,
        target: 1,
        elapsed: 0,
        duration: 250,
      };
      this.groups.set(group, entry);
    }
    entry.parts.push(part);
  }
  update(sim: Simulation, alpha: number, ms: number) {
    const actors = [sim.hero, ...sim.enemies.filter((a) => a.health > 0)],
      cos = Math.cos((contract.elevationDeg * Math.PI) / 180);
    for (const group of this.groups.values()) {
      const margin = group.obscured ? 0.15 : 0;
      const obscures = group.parts.some((p) =>
        actors.some((a) => {
          const root = new Vector3(a.px + (a.x - a.px) * alpha, a.y, a.pz + (a.z - a.pz) * alpha),
            x = root.dot(right),
            y = root.dot(up),
            foot = p.foot.clone();
          if (p.wall) {
            const w = p.wall,
              dx = w.to.x - w.from.x,
              dz = w.to.z - w.from.z,
              t = Math.max(
                0,
                Math.min(
                  1,
                  ((root.x - w.from.x) * dx + (root.z - w.from.z) * dz) / (dx * dx + dz * dz),
                ),
              );
            foot.set(w.from.x + dx * t, a.y, w.from.z + dz * t);
          } else foot.y = a.y;
          const top = y + (a.kind === 'hero' ? contract.heroHeight : 1.7) * cos + margin;
          return (
            root.clone().sub(foot).dot(outward) < 0.1 + margin &&
            x + 0.4 + margin > p.left &&
            x - 0.4 - margin < p.right &&
            top > p.bottom &&
            y - margin < p.top &&
            overlaps(p.polygon, x - 0.4 - margin, x + 0.4 + margin, y - margin, top)
          );
        }),
      );
      group.obscured = obscures;
      const target = obscures ? 0.18 : 1,
        duration = obscures ? 150 : 250;
      if (target !== group.target) {
        group.from = group.opacity;
        group.target = target;
        group.elapsed = 0;
        group.duration = duration;
      }
      group.elapsed = Math.min(group.duration, group.elapsed + Math.max(0, ms));
      const t = group.elapsed / group.duration,
        ease = t * t * (3 - 2 * t);
      group.opacity =
        group.elapsed === group.duration
          ? group.target
          : group.from + (group.target - group.from) * ease;
      for (const part of group.parts)
        for (const material of (Array.isArray(part.mesh.material)
          ? part.mesh.material
          : [part.mesh.material]) as Material[])
          setCutoutOpacity(material, group.opacity);
    }
  }
}
