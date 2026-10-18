import type { GroundRegion, MaskShape } from '../../src/content/ground-interaction';
import type { SceneDocument } from '../../src/content/scene-document';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import { resolveScene } from '../../src/content/world-art';
import { clearSegment } from '../../src/content/collision';

/** Exact vertical coverage at a source-image column, including holes and separate islands. */
export function maskIntervals(mask: readonly MaskShape[], u: number) {
  const intervals: [number, number][] = [];
  for (const shape of mask) {
    const crossings: number[] = [];
    for (const ring of [shape.outer, ...shape.holes])
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          b = ring[(i + 1) % ring.length]!;
        if ((a[0] <= u && b[0] > u) || (b[0] <= u && a[0] > u))
          crossings.push(a[1] + ((u - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
      }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2)
      intervals.push([crossings[i]!, crossings[i + 1]!]);
  }
  return intervals.sort((a, b) => a[0] - b[0]);
}
function maskBounds(region: GroundRegion) {
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const shape of region.mask ?? [])
    for (const [u, v] of shape.outer) {
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  return { minU, maxU, minV, maxV };
}
export function depthV(
  region: GroundRegion,
  u: number,
  layout: ReturnType<typeof artworkFloorLayout>,
) {
  if (!region.depth) return -Infinity;
  if (region.depth.kind === 'anchor') return layout.uv(region.depth.point)[1];
  const points = region.depth.points.map((p) => layout.uv(p));
  let i = 1;
  while (i < points.length - 1 && points[i]![0] < u) i++;
  const a = points[i - 1]!,
    b = points[i]!;
  const t = Math.max(0, Math.min(1, (u - a[0]) / (b[0] - a[0])));
  return a[1] + (b[1] - a[1]) * t;
}
export type OcclusionFinding = {
  region: string;
  name: string;
  kind: 'depth-below-silhouette' | 'mask-beyond-boundary';
  gapPixels: number;
  bounds: ReturnType<typeof maskBounds>;
  witness?: { u: number; v: number; x: number; z: number; hiddenProbeColumns: number };
};
export const auditProbe = { width: 0.9, height: 1.8, radius: 0.3 };
/** Advisory geometry checks; painted semantics cannot be inferred from polygons alone. */
export function auditGroundOcclusion(document: SceneDocument): OcclusionFinding[] {
  const ground = document.groundInteraction;
  if (!ground) return [];
  const layout = artworkFloorLayout(document.floor.width, document.floor.depth);
  const { area } = resolveScene(document);
  const findings: OcclusionFinding[] = [];
  for (const region of ground.regions) {
    if (!region.mask?.length || !region.depth) continue;
    const bounds = maskBounds(region);
    const points = region.depth.kind === 'anchor' ? [region.depth.point] : region.depth.points;
    // Piecewise-linear depth reaches its extrema at its knots and mask endpoints.
    const us = [bounds.minU, bounds.maxU, ...points.map((p) => layout.uv(p)[0])].filter(
      (u) => u >= bounds.minU && u <= bounds.maxU,
    );
    const minDepth = Math.min(...us.map((u) => depthV(region, u, layout)));
    const gapPixels = (minDepth - bounds.maxV) * ground.dimensions[1];
    if (gapPixels > 8) {
      const finding: OcclusionFinding = {
        region: region.id,
        name: region.name,
        kind: 'depth-below-silhouette',
        gapPixels,
        bounds,
      };
      // Sweep a fixed, explicitly reported rectangular actor proxy in collision-valid ground.
      // This supplies reproduction locations, not a verdict about the painting.
      for (let i = 0; i < 17 && !finding.witness; i++) {
        const u = bounds.minU + ((bounds.maxU - bounds.minU) * (i + 0.5)) / 17;
        for (const t of [0.25, 0.5, 0.75]) {
          const v = bounds.maxV + (minDepth - bounds.maxV) * t;
          const point = layout.world([u, v]);
          if (!clearSegment(area, point, point, auditProbe.radius)) continue;
          let hiddenProbeColumns = 0;
          for (let j = 0; j < 33; j++) {
            const sampleU = u + ((j / 32 - 0.5) * auditProbe.width) / document.floor.width;
            if (depthV(region, sampleU, layout) <= v) continue;
            const top = v - auditProbe.height / document.floor.depth;
            if (maskIntervals(region.mask, sampleU).some(([a, b]) => b > top && a < v))
              hiddenProbeColumns++;
          }
          if (hiddenProbeColumns) finding.witness = { u, v, ...point, hiddenProbeColumns };
        }
      }
      findings.push(finding);
    }
    if (region.depth.kind === 'boundary') {
      const left = layout.uv(region.depth.points[0]!)[0];
      const right = layout.uv(region.depth.points.at(-1)!)[0];
      const gap = Math.max(left - bounds.minU, bounds.maxU - right) * ground.dimensions[0];
      if (gap > 8)
        findings.push({
          region: region.id,
          name: region.name,
          kind: 'mask-beyond-boundary',
          gapPixels: gap,
          bounds,
        });
    }
  }
  return findings;
}

/** Only use for a visually reviewed solid prop whose lower silhouette is its ground contact. */
export function contactDepthRepair(document: SceneDocument, regionId: string) {
  const region = document.groundInteraction?.regions.find((r) => r.id === regionId);
  if (!region?.mask?.length || region.depth?.kind !== 'boundary')
    throw new Error('Contact repair requires a mask and depth boundary: ' + regionId);
  if (
    !auditGroundOcclusion(document).some(
      (f) => f.region === regionId && f.kind === 'depth-below-silhouette',
    )
  )
    throw new Error('Contact repair requires a depth-below-silhouette finding: ' + regionId);
  const layout = artworkFloorLayout(document.floor.width, document.floor.depth);
  const bounds = maskBounds(region);
  if (region.mask.length !== 1)
    throw new Error('Contact repair needs one continuous solid silhouette: ' + regionId);
  const [w, h] = document.groundInteraction!.dimensions;
  const samples: [number, number][] = [];
  for (let x = Math.ceil(bounds.minU * w); x < Math.floor(bounds.maxU * w); x++) {
    const u = (x + 0.5) / w;
    const spans = maskIntervals(region.mask, u);
    if (!spans.length) throw new Error('Gap in contact silhouette: ' + regionId);
    samples.push([x + 0.5, Math.max(...spans.map((span) => span[1])) * h]);
  }
  if (samples.length < 3) throw new Error('Contact silhouette is too narrow: ' + regionId);
  // Simplify only the depth envelope (two source pixels); preserve the original mask exactly.
  const keep = new Set([0, samples.length - 1]);
  const pending = [[0, samples.length - 1]];
  while (pending.length) {
    const [first, last] = pending.pop()!;
    const a = samples[first!]!,
      b = samples[last!]!;
    let farthest = -1,
      distance = 2;
    for (let i = first! + 1; i < last!; i++) {
      const p = samples[i]!;
      const v = a[1] + ((b[1] - a[1]) * (p[0] - a[0])) / (b[0] - a[0]);
      if (Math.abs(p[1] - v) > distance) {
        distance = Math.abs(p[1] - v);
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep.add(farthest);
      pending.push([first!, farthest], [farthest, last!]);
    }
  }
  const points = [...keep]
    .sort((a, b) => a - b)
    .map((i) => layout.world([samples[i]![0] / w, samples[i]![1] / h]));
  return { kind: 'boundary' as const, points };
}
