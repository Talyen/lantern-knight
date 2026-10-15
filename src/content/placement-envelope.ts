import { boundsCorners, polygonBounds, segmentsIntersect } from './polygon';
import { contains } from './collision';
import type { Manifest } from '../assets/schema';
import { trimmedBounds } from '../assets/sprite-registration';
import { artworkFloorLayout } from './floor-layout';
import { insidePolygon } from './graveyard-layout';
import type { SceneSnapshot } from './scene-document';
import type { Point } from './world';
import { placementRegistration, type PlacementEnvelope } from './placement-registration';
export type { PlacementEnvelope } from './placement-registration';
import { cameraContract } from '../assets/camera-contract';

// Reserve measured native alpha extents, falling back to the full registered
// trim for an unmeasured or changed kit. Reserve every drawing of the supplied
// placement clips; callers exclude attack and flying destruction debris.
export function spritePlacementEnvelope(
  manifest: Manifest,
  clips: readonly string[],
): PlacementEnvelope {
  const measured = placementRegistration[manifest.asset.id];
  const registered = measured?.hash === manifest.hash ? measured.clips : {};
  const ids = new Set(
    clips
      .filter((name) => !registered[name])
      .flatMap((name) =>
        Object.values(manifest.asset.clips[name] ?? {}).flatMap((clip) =>
          clip ? clip.frames : [],
        ),
      ),
  );
  const bounds = [
    ...clips.flatMap((name) => (registered[name] ? [registered[name]!] : [])),
    ...manifest.frames
      .filter((f) => ids.has(f.id))
      .map((frame) => {
        const registration = frame.registration ?? manifest.asset;
        const b = trimmedBounds(registration, frame.trim);
        const [x, y] = frame.visualOffsetPx ?? [0, 0];
        return {
          left: b.left + x / registration.density,
          right: b.right + x / registration.density,
          top: b.top - y / registration.density,
          bottom: b.bottom - y / registration.density,
        };
      }),
  ];
  if (!bounds.length) throw new Error('Placement needs a registered drawing');
  return {
    left: Math.min(...bounds.map((b) => b.left)),
    right: Math.max(...bounds.map((b) => b.right)),
    top: Math.max(...bounds.map((b) => b.top)),
    bottom: Math.min(...bounds.map((b) => b.bottom)),
  };
}

export function paintedEnvelopePolicy(
  document: Pick<SceneSnapshot, 'floor' | 'groundInteraction'>,
) {
  const layout = artworkFloorLayout(document.floor.width, document.floor.depth);
  const point = ([x, z]: readonly number[]): Point => ({ x: x!, z: z! });
  const masks = (
    document.groundInteraction?.regions.flatMap((r) => [
      ...(r.footprint
        ? [{ name: r.name, outer: r.footprint.map((p) => point(layout.uv(p))), holes: [] }]
        : []),
      ...(r.mask ?? []).map((m) => ({
        name: r.name,
        outer: m.outer.map(point),
        holes: m.holes.map((h) => h.map(point)),
      })),
    ]) ?? []
  ).map((mask) => ({
    ...mask,
    ...polygonBounds(mask.outer),
  }));
  return (
    foot: Point,
    bounds: PlacementEnvelope,
    transform: {
      scale?: number;
      mirror?: boolean;
      rotation?: number;
      y?: number;
      jitterZ?: number;
    } = {},
  ): string | undefined => {
    if (!document.groundInteraction) return;
    const scale = transform.scale ?? 1;
    const angle = transform.rotation ?? 0;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const [u, v] = layout.uv(foot);
    const samples = [bounds.left, bounds.right].flatMap((x) =>
      [bounds.top, bounds.bottom].flatMap((y) =>
        [0, transform.jitterZ ?? 0].map((jitter) => {
          const [ju, jv] = layout.uv({ x: foot.x, z: foot.z + jitter });
          const mx = x * (transform.mirror ? -1 : 1);
          return {
            x: ju + ((mx * c - y * s) * scale) / document.floor.width,
            z:
              jv -
              ((mx * s + y * c) * scale +
                (transform.y ?? 0) * Math.cos((cameraContract.elevationDeg * Math.PI) / 180)) /
                document.floor.depth,
          };
        }),
      ),
    );
    // A small quiet gap stops near-tangent silhouettes reading as clipping.
    const px = 0.12 / document.floor.width,
      py = 0.12 / document.floor.depth;
    const left = Math.min(...samples.map((p) => p.x), u) - px;
    const right = Math.max(...samples.map((p) => p.x), u) + px;
    const top = Math.min(...samples.map((p) => p.z), v) - py;
    const bottom = Math.max(...samples.map((p) => p.z), v) + py;
    if (left < 0 || right > 1 || top < 0 || bottom > 1)
      return 'registered artwork extends beyond the painting';
    const region = { minX: left, maxX: right, minZ: top, maxZ: bottom };
    const rectangle = boundsCorners(region);
    const hit = masks.find(
      (m) =>
        m.minX <= right &&
        m.maxX >= left &&
        m.minZ <= bottom &&
        m.maxZ >= top &&
        (rectangle.some(
          (p) => insidePolygon(p, m.outer) && !m.holes.some((h) => insidePolygon(p, h)),
        ) ||
          m.outer.some((p) => contains(region, p)) ||
          [m.outer, ...m.holes].some((ring) =>
            ring.some((a, i) =>
              rectangle.some((b, j) =>
                segmentsIntersect(a, ring[(i + 1) % ring.length]!, b, rectangle[(j + 1) % 4]!),
              ),
            ),
          )),
    );
    if (hit) return `registered artwork overlaps painted scenery “${hit.name}”`;
  };
}
