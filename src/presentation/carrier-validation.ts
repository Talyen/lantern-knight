import * as T from 'three';
import type { ActorSprite } from './sprite';
import { right, up } from '../core/camera';
import { cardCoverage, type CoverageMask } from './scenery-reveal';
// Adjacent projected parallelograms can share a diagonal line inside overlapping
// bounding boxes. Require positive polygon area before sampling source alpha.
function intersectionArea(a: T.Vector2[], b: T.Vector2[]) {
  const cross = (u: T.Vector2, v: T.Vector2, p: T.Vector2) =>
    (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const signed = (p: T.Vector2[]) =>
    p.reduce((sum, v, i) => {
      const q = p[(i + 1) % p.length]!;
      return sum + v.x * q.y - v.y * q.x;
    }, 0) / 2;
  const sign = Math.sign(signed(b));
  let polygon = a;
  for (let edge = 0; edge < b.length; edge++) {
    const u = b[edge]!,
      v = b[(edge + 1) % b.length]!,
      input = polygon;
    polygon = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!,
        q = input[(i + 1) % input.length]!,
        cp = cross(u, v, p) * sign,
        cq = cross(u, v, q) * sign;
      if (cp >= -1e-10) polygon.push(p);
      if (cp >= -1e-10 !== cq >= -1e-10) polygon.push(p.clone().lerp(q, cp / (cp - cq)));
    }
  }
  return Math.abs(signed(polygon));
}
export function coplanarArtConflicts(sprites: ActorSprite[], masks: Record<string, CoverageMask>) {
  const records = sprites
    .filter((s) => s.manifest.asset.type === 'prop')
    .map((s) => {
      s.mesh.updateMatrixWorld(true);
      const position = s.geometry.getAttribute('position'),
        points = Array.from({ length: position.count }, (_, i) =>
          new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(s.mesh.matrixWorld),
        );
      const normal = points[1]!
        .clone()
        .sub(points[0]!)
        .cross(points[2]!.clone().sub(points[0]!))
        .normalize();
      return {
        s,
        points,
        normal,
        left: Math.min(...points.map((p) => p.dot(right))),
        right: Math.max(...points.map((p) => p.dot(right))),
        bottom: Math.min(...points.map((p) => p.dot(up))),
        top: Math.max(...points.map((p) => p.dot(up))),
      };
    });
  const conflicts: { a: string; b: string; separation: number }[] = [];
  for (let i = 0; i < records.length; i++)
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i]!,
        b = records[j]!,
        separation = Math.abs(b.points[0]!.clone().sub(a.points[0]!).dot(a.normal));
      if (Math.abs(a.normal.dot(b.normal)) < 0.99999 || separation > 0.001) continue;
      const left = Math.max(a.left, b.left),
        rightEdge = Math.min(a.right, b.right),
        bottom = Math.max(a.bottom, b.bottom),
        top = Math.min(a.top, b.top);
      if ((rightEdge - left) * (top - bottom) < 0.002 || left >= rightEdge || bottom >= top)
        continue;
      const projected = (points: T.Vector3[]) =>
        [0, 1, 3, 2].map((i) => new T.Vector2(points[i]!.dot(right), points[i]!.dot(up)));
      if (intersectionArea(projected(a.points), projected(b.points)) < 1e-8) continue;
      let hits = 0;
      for (let y = 0; y < 12; y++)
        for (let x = 0; x < 12; x++) {
          const point = new T.Vector3()
            .addScaledVector(right, left + ((x + 0.5) / 12) * (rightEdge - left))
            .addScaledVector(up, bottom + ((y + 0.5) / 12) * (top - bottom));
          if (
            cardCoverage(a.s, point, masks[`${a.s.manifest.asset.id}:${a.s.animator.frame}`]) >
              0.45 &&
            cardCoverage(b.s, point, masks[`${b.s.manifest.asset.id}:${b.s.animator.frame}`]) > 0.45
          )
            hits++;
        }
      if (hits >= 2) conflicts.push({ a: a.s.id, b: b.s.id, separation });
    }
  return conflicts;
}
