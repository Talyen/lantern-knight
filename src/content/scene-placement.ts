import { sceneObjects } from './campfire-visuals';
import {
  polygonEdgeDistance,
  insidePolygon,
  closestPointOnSegment,
  segmentsIntersect,
} from './polygon';
import { isSupportedPosition, clearSegment, effectiveRadius } from './collision';
import { artworkFloorLayout } from './floor-layout';
import type { SceneSnapshot } from './scene-document';
import type { AreaDefinition, Point } from './world';
import type { WorldVisualDefinition } from './world-visuals';
import type { Manifest } from '../assets/schema';
import { paintedEnvelopePolicy, spritePlacementEnvelope } from './placement-envelope';
import { actors } from './actors';
import { actorVisuals } from './visuals';

export type PlacementFinding = { id: string; message: string };
function spawnPlacementAssets(document: SceneSnapshot): string[] {
  return [
    ...new Set(
      (document.gameplay?.spawns ?? []).map((spawn) => {
        const actor = actors.find((a) => a.id === spawn.actor);
        const visual = actor && actorVisuals[actor.visual];
        if (!visual) throw new Error('Unknown spawn artwork: ' + spawn.id);
        return visual.asset;
      }),
    ),
  ];
}

/** Every static asset root a scene needs before its packs can be validated. */
export function sceneAssetIds(document: SceneSnapshot): Set<string> {
  return new Set([
    ...spawnPlacementAssets(document),
    ...document.proceduralAssets,
    ...(document.surround?.layers.map((layer) => layer.asset) ?? []),
    ...sceneObjects(document).flatMap((p) => [
      p.asset,
      ...(p.fixture?.flame ? [p.fixture.flame.asset] : []),
    ]),
    ...(document.floor ? [document.floor.asset] : []),
  ]);
}

export function sceneEnvelopeFindings(
  document: SceneSnapshot,
  manifests: ReadonlyMap<string, Manifest>,
): PlacementFinding[] {
  if (!document.groundInteraction) return [];
  const inspect = paintedEnvelopePolicy(document);
  type Interactable = NonNullable<NonNullable<SceneSnapshot['gameplay']>['interactables']>[number];
  const interactions = new Map<string, Interactable>();
  for (const p of document.gameplay?.interactables ?? [])
    if (!interactions.has(p.object)) interactions.set(p.object, p);
  const campfires = new Set(
    (document.gameplay?.campfires ?? []).map((p) => p.object ?? 'campfire-' + p.id),
  );
  const pickups = new Set((document.gameplay?.pickups ?? []).map((p) => p.object));
  const findings: PlacementFinding[] = [];
  for (const object of sceneObjects(document)) {
    const interaction = interactions.get(object.id);
    const pickup = pickups.has(object.id) || campfires.has(object.id);
    // Static scenery may sit partly behind painted foliage. Gameplay targets
    // still reserve their complete drawing so they begin fully discoverable.
    if (!interaction && !pickup && object.kind === 'prop') continue;
    if (
      (object.kind !== 'prop' && object.kind !== 'character') ||
      (!interaction && !pickup && object.role === 'ground') ||
      object.role === 'attachment'
    )
      continue;
    const manifest = manifests.get(object.asset);
    if (!manifest || (!interaction && manifest.asset.placement === 'ground')) continue;
    const message = inspect(
      { x: object.x!, z: object.z! },
      spritePlacementEnvelope(
        manifest,
        interaction?.kind === 'container'
          ? [...new Set([object.clip, interaction.idle, interaction.action, interaction.spent])]
          : [object.clip],
      ),
      object,
    );
    if (message) findings.push({ id: object.id, message: `${object.id}: ${message}` });
  }
  for (const spawn of document.gameplay?.spawns ?? []) {
    const actor = actors.find((a) => a.id === spawn.actor);
    const visual = actor && actorVisuals[actor.visual];
    const manifest = visual && manifests.get(visual.asset);
    if (!manifest || !visual) throw new Error('Missing spawn artwork: ' + spawn.id);
    const message = inspect(
      spawn,
      spritePlacementEnvelope(manifest, [visual.clips.idle, visual.clips.walk]),
      { ...spawn, scale: visual.scale ?? 1 },
    );
    if (message) findings.push({ id: spawn.id, message: `${spawn.id}: ${message}` });
  }
  return findings;
}
// Authoring placement is stricter than movement: characters may walk beneath a
// canopy, but a spawn or upright prop must begin on visibly clear ground.
function paintedTerrain(document: SceneSnapshot, area: AreaDefinition): AreaDefinition {
  const paintedColliders = new Set(
    document.groundInteraction?.regions.filter((r) => r.footprint).map((r) => 'ground-' + r.id),
  );
  return {
    ...area,
    playableBoundary: area.sceneBoundary ?? area.playableBoundary,
    props: area.props.filter((p) => paintedColliders.has(p.id)),
  };
}
function paintedMasks(document: SceneSnapshot) {
  const layout = artworkFloorLayout(document.floor.width, document.floor.depth);
  return (
    document.groundInteraction?.regions.flatMap((region) =>
      (region.mask ?? []).map((shape) => ({
        name: region.name,
        outer: shape.outer.map(layout.world),
        holes: shape.holes.map((ring) => ring.map(layout.world)),
      })),
    ) ?? []
  );
}
function maskAlongSegment(document: SceneSnapshot, start: Point, end: Point, radius: number) {
  const masks = paintedMasks(document);
  const distance = (point: Point, a: Point, b: Point) => {
    const nearest = closestPointOnSegment(point, a, b);
    return Math.hypot(point.x - nearest.x, point.z - nearest.z);
  };
  const hit = masks.find((mask) =>
    [mask.outer, ...mask.holes].some((ring) =>
      ring.some((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        return (
          segmentsIntersect(start, end, a, b) ||
          Math.min(
            distance(start, a, b),
            distance(end, a, b),
            distance(a, start, end),
            distance(b, start, end),
          ) <= radius
        );
      }),
    ),
  );
  return hit ? `base overlaps painted scenery “${hit.name}”` : undefined;
}
export function groundPlacementPolicy(document: SceneSnapshot, area: AreaDefinition) {
  const ground = document.groundInteraction;
  const masks = paintedMasks(document);
  const terrain = paintedTerrain(document, area);
  return (point: Point, radius: number, allowPaintedOcclusion = false): string | undefined => {
    if (!ground) return;
    if (!isSupportedPosition(terrain, point, radius))
      return 'base overlaps painted collision or the floor edge';
    if (allowPaintedOcclusion) return;
    const mask = masks.find(
      (m) =>
        (insidePolygon(point, m.outer) || polygonEdgeDistance(point, m.outer) <= radius) &&
        !m.holes.some((h) => insidePolygon(point, h) && polygonEdgeDistance(point, h) > radius),
    );
    if (mask) return `base overlaps painted scenery “${mask.name}”`;
  };
}
export function scenePlacementFindings(
  document: SceneSnapshot,
  area: AreaDefinition,
  art: WorldVisualDefinition,
): PlacementFinding[] {
  const inspect = groundPlacementPolicy(document, area);
  const findings: PlacementFinding[] = [];
  // Match the first object for a placement, mirroring the interactable lookup.
  const objects = new Map<string, (typeof document.objects)[number]>();
  for (const object of sceneObjects(document))
    if (!objects.has(object.id)) objects.set(object.id, object);
  const interactive = new Set([
    ...(area.interactables?.map((p) => p.object) ?? []),
    ...(area.pickups?.map((p) => p.object) ?? []),
    ...(document.gameplay?.campfires?.map((p) => p.object ?? 'campfire-' + p.id) ?? []),
  ]);
  const check = (id: string, point: Point, radius: number, allowPaintedOcclusion = false) => {
    const message = inspect(point, radius, allowPaintedOcclusion);
    if (message) findings.push({ id, message: `${id}: ${message}` });
  };
  for (const prop of art.props) {
    const object = objects.get(prop.id);
    if (object?.kind !== 'prop' && object?.kind !== 'character') continue;
    if (prop.role === 'ground' || prop.role === 'attachment') continue;
    const radius = prop.footprint
      ? Math.hypot(prop.footprint[0], prop.footprint[1]) / 2
      : 0.3 * (prop.scale ?? 1);
    check(prop.id, prop, radius, object.kind === 'prop' && !interactive.has(prop.id));
  }
  for (const spawn of area.spawns) {
    if (!document.groundInteraction) continue;
    const actorDef = actors.find((a) => a.id === spawn.actor);
    const radius = effectiveRadius(actorDef?.radius ?? 0.3);
    const jitter = spawn.jitterZ ?? 0;
    const start = { x: spawn.x, z: spawn.z };
    const end = { x: spawn.x, z: spawn.z + jitter };
    // Validate the swept capsule with the same clearance the runtime uses,
    // instead of inflating sideways with an oversized circle.
    const terrain = paintedTerrain(document, area);
    if (!clearSegment(terrain, start, end, radius)) {
      findings.push({
        id: spawn.id,
        message: `${spawn.id}: base overlaps painted collision or the floor edge`,
      });
      continue;
    }
    // Endpoints detect complete containment; boundary distance catches even
    // a grazing contact between them, including the boundaries of mask holes.
    const message =
      inspect(start, radius) ??
      inspect(end, radius) ??
      maskAlongSegment(document, start, end, radius);
    if (message) findings.push({ id: spawn.id, message: `${spawn.id}: ${message}` });
  }
  return findings;
}
