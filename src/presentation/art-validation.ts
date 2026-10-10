import { placementOffset } from '../content/scenery-presets';
import { Vector3, type Mesh } from 'three';
import { right, up } from '../core/camera';
import type { WorldVisualDefinition } from '../content/world-visuals';
import { isSupportedPosition, type AreaDefinition } from '../content/world';

export type AlphaImage = { width: number; height: number; data: Uint8Array };
export type DepthConflict = {
  a: string;
  b: string;
  samples: number;
  bounds: readonly [number, number, number, number];
};
const partId = (mesh: Mesh) => mesh.userData.artPart?.id || mesh.name || mesh.uuid;
type Vertex = { p: Vector3; x: number; y: number; u: number; v: number };
function coverage(mesh: Mesh, image: AlphaImage | undefined, x: number, y: number) {
  const position = mesh.geometry.getAttribute('position'),
    uv = mesh.geometry.getAttribute('uv'),
    indices = mesh.geometry.index;
  if (!uv) return 1;
  const vertices: Vertex[] = [];
  for (let i = 0; i < position.count; i++) {
    const p = new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    vertices.push({ p, x: p.dot(right), y: p.dot(up), u: uv.getX(i), v: uv.getY(i) });
  }
  for (let i = 0; i < (indices?.count ?? vertices.length); i += 3) {
    const a = vertices[indices ? indices.getX(i) : i]!,
      b = vertices[indices ? indices.getX(i + 1) : i + 1]!,
      c = vertices[indices ? indices.getX(i + 2) : i + 2]!;
    const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(d) < 1e-10) continue;
    const aa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d,
      bb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d,
      cc = 1 - aa - bb;
    if (Math.min(aa, bb, cc) < -1e-7) continue;
    if (!image) return 1;
    const u = aa * a.u + bb * b.u + cc * c.u,
      v = aa * a.v + bb * b.v + cc * c.v,
      px = Math.max(0, Math.min(image.width - 1, Math.floor(u * image.width))),
      py = Math.max(0, Math.min(image.height - 1, Math.floor((1 - v) * image.height)));
    return image.data[(py * image.width + px) * 4 + 3]! / 255;
  }
  return 0;
}
// Tests visible alpha, not the transparent rectangles around illustrations.
export function findDepthConflicts(
  meshes: readonly Mesh[],
  images: ReadonlyMap<Mesh, AlphaImage>,
  pixelsPerMetre = 128,
): DepthConflict[] {
  const parts = meshes
    .filter(
      (m) => !Array.isArray(m.material) && !m.material.transparent && m.material.opacity >= 0.99,
    )
    .map((mesh) => {
      mesh.updateMatrixWorld(true);
      const p = mesh.geometry.getAttribute('position'),
        vertices = Array.from({ length: p.count }, (_, i) =>
          new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld),
        );
      const n = vertices[1]!
        .clone()
        .sub(vertices[0]!)
        .cross(vertices[2]!.clone().sub(vertices[0]!))
        .normalize();
      return {
        mesh,
        n,
        point: vertices[0]!,
        left: Math.min(...vertices.map((v) => v.dot(right))),
        right: Math.max(...vertices.map((v) => v.dot(right))),
        bottom: Math.min(...vertices.map((v) => v.dot(up))),
        top: Math.max(...vertices.map((v) => v.dot(up))),
      };
    });
  const findings: DepthConflict[] = [];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!,
        b = parts[j]!;
      if (
        Math.abs(a.n.dot(b.n)) < 0.999999 ||
        Math.abs(a.n.dot(b.point.clone().sub(a.point))) > 0.001
      )
        continue;
      const l = Math.max(a.left, b.left),
        r = Math.min(a.right, b.right),
        lo = Math.max(a.bottom, b.bottom),
        hi = Math.min(a.top, b.top);
      if (r - l < 1 / pixelsPerMetre || hi - lo < 1 / pixelsPerMetre) continue;
      let count = 0;
      const am = Array.isArray(a.mesh.material) ? a.mesh.material[0]! : a.mesh.material,
        bm = Array.isArray(b.mesh.material) ? b.mesh.material[0]! : b.mesh.material,
        ai = am.alphaTest > 0 ? images.get(a.mesh) : undefined,
        bi = bm.alphaTest > 0 ? images.get(b.mesh) : undefined;
      for (let y = lo + 0.5 / pixelsPerMetre; y < hi; y += 1 / pixelsPerMetre)
        for (let x = l + 0.5 / pixelsPerMetre; x < r; x += 1 / pixelsPerMetre) {
          const aa = coverage(a.mesh, ai, x, y),
            bb = coverage(b.mesh, bi, x, y);
          if (aa > 0 && bb > 0 && aa >= am.alphaTest && bb >= bm.alphaTest) count++;
        }
      if (count > 1)
        findings.push({
          a: partId(a.mesh),
          b: partId(b.mesh),
          samples: count,
          bounds: [l, lo, r, hi],
        });
    }
  return findings;
}
export function validateConstruction(area: AreaDefinition, art: WorldVisualDefinition) {
  const errors: string[] = [];
  const byId = new Map(art.props.map((p) => [p.id, p]));
  for (const p of art.props) {
    if (p.mount) {
      const parent = byId.get(p.mount.to),
        wall = art.walls.find((w) => w.id === p.mount!.to);
      if (!parent && !wall) {
        errors.push(`${p.id}: missing support ${p.mount.to}`);
        continue;
      }
      const root = parent ?? { x: wall!.from.x, z: wall!.from.z, y: 0 },
        [x, y, z] = placementOffset(parent ?? {}, p.mount.offset);
      if (
        Math.hypot(p.x - root.x - x, p.z - root.z - z) > 1e-6 ||
        Math.abs((p.y ?? 0) - (root.y ?? 0) - y) > 1e-6
      )
        errors.push(`${p.id}: mount differs from support socket`);
    }
    if (p.wallFace) {
      const w = art.walls.find((w) => w.id === p.wallFace);
      if (!w) {
        errors.push(`${p.id}: missing wall receiver`);
        continue;
      }
      const dx = w.to.x - w.from.x,
        dz = w.to.z - w.from.z,
        len = Math.hypot(dx, dz),
        distance = Math.abs((p.x - w.from.x) * dz - (p.z - w.from.z) * dx) / len;
      if (Math.abs(distance - w.thickness / 2) > 0.025)
        errors.push(`${p.id}: face is detached from its receiver`);
    }
  }
  const solids = art.props.filter((p) => p.footprint && !p.mount);
  for (let i = 0; i < solids.length; i++)
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i]!,
        b = solids[j]!,
        ax = a.footprint![0] / 2,
        az = a.footprint![1] / 2,
        bx = b.footprint![0] / 2,
        bz = b.footprint![1] / 2;
      if (Math.abs(a.x - b.x) < ax + bx - 0.01 && Math.abs(a.z - b.z) < az + bz - 0.01)
        errors.push(`${a.id}/${b.id}: occupied footprints intersect`);
    }
  for (const p of solids)
    for (const w of art.walls) {
      const halfX = p.footprint![0] / 2,
        halfZ = p.footprint![1] / 2,
        l = Math.max(p.x - halfX, Math.min(w.from.x, w.to.x) - w.thickness / 2),
        r = Math.min(p.x + halfX, Math.max(w.from.x, w.to.x) + w.thickness / 2),
        b = Math.max(p.z - halfZ, Math.min(w.from.z, w.to.z) - w.thickness / 2),
        t = Math.min(p.z + halfZ, Math.max(w.from.z, w.to.z) + w.thickness / 2);
      if (r - l <= 0.01 || t - b <= 0.01) continue;
      const seam = art.overlaps?.find(
        (v) =>
          ((v.a === p.id && v.b === w.id) || (v.a === w.id && v.b === p.id)) &&
          v.region.minX <= l &&
          v.region.maxX >= r &&
          v.region.minZ <= b &&
          v.region.maxZ >= t &&
          v.reason.trim(),
      );
      if (!seam) errors.push(`${p.id}/${w.id}: solid intersects wall outside a registered seam`);
    }
  for (const entry of area.entries)
    if (!isSupportedPosition(area, entry, 0.3)) errors.push(`${entry.id}: entry is obstructed`);
  // A continuous six-metre central route is reserved for fighting and retreat.
  if (art.interior)
    for (let z = -5.5; z <= 8.2; z += 0.25)
      for (let x = -2.7; x <= 2.7; x += 0.3)
        if (!isSupportedPosition(area, { x, z }, 0.3))
          errors.push(`nave clearance obstructed at ${x.toFixed(2)},${z.toFixed(2)}`);
  return errors;
}
