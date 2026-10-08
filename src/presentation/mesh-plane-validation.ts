import * as T from 'three';
import { outward } from '../core/camera';

// At the locked camera, opaque, equally facing construction surfaces must not compete for one depth plane.
// Intersecting volumes and opposed butt faces are intentional structural joins.
export function coplanarMeshConflicts(meshes: T.Mesh[]) {
  const faces = meshes.flatMap((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((m) => m.alphaTest > 0 || (m.transparent && !mesh.userData.stableReveal)))
      return [];
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.getAttribute('position'),
      index = mesh.geometry.index,
      count = index?.count ?? position.count,
      result = [];
    for (let i = 0; i < count; i += 3) {
      const points = [0, 1, 2].map((j) =>
        new T.Vector3()
          .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)
          .applyMatrix4(mesh.matrixWorld),
      );
      const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!));
      if (normal.lengthSq() < 1e-10) continue;
      normal.normalize();
      if (normal.dot(outward) <= 0.0001) continue;
      result.push({ mesh, points, normal, distance: normal.dot(points[0]!) });
    }
    return result;
  });
  const conflicts = new Map<string, { a: string; b: string; separation: number }>();
  type P = { x: number; y: number };
  const cross = (a: P, b: P, p: P) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i]!,
        b = faces[j]!;
      if (a.mesh === b.mesh || a.normal.dot(b.normal) < 0.999999) continue;
      const separation = Math.abs(a.normal.dot(b.points[0]!) - a.distance);
      if (separation > 0.001) continue;
      const u = new T.Vector3()
          .crossVectors(
            Math.abs(a.normal.y) < 0.9 ? new T.Vector3(0, 1, 0) : new T.Vector3(0, 0, 1),
            a.normal,
          )
          .normalize(),
        v = a.normal.clone().cross(u);
      const project = (p: T.Vector3): P => ({ x: p.dot(u), y: p.dot(v) }),
        ap = a.points.map(project),
        bp = b.points.map(project);
      if (
        ['x', 'y'].some((axis) => {
          const k = axis as keyof P;
          return (
            Math.min(Math.max(...ap.map((p) => p[k])), Math.max(...bp.map((p) => p[k]))) -
              Math.max(Math.min(...ap.map((p) => p[k])), Math.min(...bp.map((p) => p[k]))) <
            0.001
          );
        })
      )
        continue;
      let polygon = ap;
      for (let k = 0; k < 3; k++) {
        const edge = bp[k]!,
          end = bp[(k + 1) % 3]!,
          input = polygon;
        polygon = [];
        for (let n = 0; n < input.length; n++) {
          const p = input[n]!,
            q = input[(n + 1) % input.length]!,
            cp = cross(edge, end, p),
            cq = cross(edge, end, q);
          if (cp >= 0) polygon.push(p);
          if (cp >= 0 !== cq >= 0) {
            const t = cp / (cp - cq);
            polygon.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
          }
        }
      }
      const area =
        Math.abs(
          polygon.reduce((sum, p, k) => {
            const q = polygon[(k + 1) % polygon.length]!;
            return sum + p.x * q.y - q.x * p.y;
          }, 0),
        ) / 2;
      if (area < 0.0001) continue;
      const aid = String(a.mesh.userData.id ?? a.mesh.uuid),
        bid = String(b.mesh.userData.id ?? b.mesh.uuid),
        key = [aid, bid].sort().join(':');
      conflicts.set(key, { a: aid, b: bid, separation });
    }
  return [...conflicts.values()];
}
