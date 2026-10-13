import { z } from 'zod';
import { artworkFloorLayout } from './floor-layout';
import type { Point } from './world';
const point = z.strictObject({ x: z.number().finite(), z: z.number().finite() });
const uv = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const ring = z.array(uv).min(3);
export const GroundInteractionSchema = z
  .strictObject({
    asset: z.string(),
    frame: z.string(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    dimensions: z.tuple([
      z.number().int().positive().max(16384),
      z.number().int().positive().max(16384),
    ]),
    regions: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          name: z.string().trim().min(1).max(80),
          footprint: z.array(point).min(3).optional(),
          mask: z.array(z.strictObject({ outer: ring, holes: z.array(ring) })).optional(),
          depth: z
            .union([
              z.strictObject({ kind: z.literal('anchor'), point }),
              z.strictObject({ kind: z.literal('boundary'), points: z.array(point).min(2) }),
            ])
            .optional(),
        }),
      )
      .max(256),
    destinations: z
      .array(point.extend({ name: z.string().min(1).max(80), reachable: z.boolean().optional() }))
      .default([]),
  })
  .superRefine((g, ctx) => {
    const ids = new Set<string>();
    for (const r of g.regions) {
      if (ids.has(r.id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate ground region: ' + r.id });
      ids.add(r.id);
      if (r.mask?.length && !r.depth)
        ctx.addIssue({
          code: 'custom',
          message: 'Occlusion mask needs a depth anchor or boundary: ' + r.name,
        });
      if (r.footprint && !simplePolygon(r.footprint))
        ctx.addIssue({
          code: 'custom',
          message: 'Footprint must be a simple nondegenerate polygon: ' + r.name,
        });
      if (r.depth?.kind === 'boundary') {
        const xs = r.depth.points.map((p) => artworkFloorLayout(1, 1).uv(p)[0]);
        if (!xs.every((v, i) => i === 0 || v > xs[i - 1]! + 1e-8))
          ctx.addIssue({
            code: 'custom',
            message: 'Depth boundary points must run left to right: ' + r.name,
          });
      }
    }
  });
export type GroundInteraction = z.infer<typeof GroundInteractionSchema>;
export type GroundRegion = GroundInteraction['regions'][number];
export type MaskShape = NonNullable<GroundRegion['mask']>[number];
function simplePolygon(points: readonly Point[]) {
  let area = 0;
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    if (Math.hypot(a.x - b.x, a.z - b.z) < 1e-8) return false;
    area += a.x * b.z - b.x * a.z;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j]!,
        d = points[(j + 1) % points.length]!;
      if (
        cross(a, b, c) * cross(a, b, d) <= 0 &&
        cross(c, d, a) * cross(c, d, b) <= 0 &&
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.z, b.z), Math.min(c.z, d.z)) <=
          Math.min(Math.max(a.z, b.z), Math.max(c.z, d.z))
      )
        return false;
    }
  }
  return Math.abs(area) > 1e-8;
}
export function resizeGroundInteraction(
  g: GroundInteraction,
  before: { width: number; depth: number },
  after: { width: number; depth: number },
) {
  const old = artworkFloorLayout(before.width, before.depth),
    next = artworkFloorLayout(after.width, after.depth);
  const transform = (p: Point) => next.world(old.uv(p));
  for (const r of g.regions) {
    if (r.footprint) r.footprint = r.footprint.map(transform);
    if (r.depth?.kind === 'anchor') r.depth.point = transform(r.depth.point);
    else if (r.depth) r.depth.points = r.depth.points.map(transform);
  }
  g.destinations = g.destinations.map((p) => ({ ...p, ...transform(p) }));
}
