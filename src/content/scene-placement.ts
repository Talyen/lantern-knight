import { polygonEdgeDistance } from './polygon';
import { insidePolygon } from './graveyard-layout';
import { isSupportedPosition } from './collision';
import { artworkFloorLayout } from './floor-layout';
import type { SceneSnapshot } from './scene-document';
import type { AreaDefinition, Point } from './world';
import type { WorldVisualDefinition } from './world-visuals';
import type { Manifest } from '../assets/schema';
import { paintedEnvelopePolicy, spritePlacementEnvelope } from './placement-envelope';
import { actors } from './actors';
import { actorVisuals } from './visuals';

export type PlacementFinding = { id: string; message: string };
export function spawnPlacementAssets(document: SceneSnapshot): string[] {
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

export function sceneEnvelopeFindings(
  document: SceneSnapshot,
  manifests: ReadonlyMap<string, Manifest>,
): PlacementFinding[] {
  if (!document.groundInteraction) return [];
  const inspect = paintedEnvelopePolicy(document);
  const findings: PlacementFinding[] = [];
  for (const object of document.objects) {
    const interaction = document.gameplay?.interactables?.find((p) => p.object === object.id);
    const pickup = document.gameplay?.pickups.some((p) => p.object === object.id);
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
      spawn,
    );
    if (message) findings.push({ id: spawn.id, message: `${spawn.id}: ${message}` });
  }
  return findings;
}
// Authoring placement is stricter than movement: characters may walk beneath a
// canopy, but a spawn or upright prop must begin on visibly clear ground.
export function groundPlacementPolicy(document: SceneSnapshot, area: AreaDefinition) {
  const ground = document.groundInteraction;
  const layout = artworkFloorLayout(document.floor.width, document.floor.depth);
  const masks =
    ground?.regions.flatMap((region) =>
      (region.mask ?? []).map((shape) => ({
        name: region.name,
        outer: shape.outer.map(layout.world),
        holes: shape.holes.map((ring) => ring.map(layout.world)),
      })),
    ) ?? [];
  const paintedColliders = new Set(
    ground?.regions.filter((r) => r.footprint).map((r) => 'ground-' + r.id),
  );
  const terrain = { ...area, props: area.props.filter((p) => paintedColliders.has(p.id)) };
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
  const check = (id: string, point: Point, radius: number, allowPaintedOcclusion = false) => {
    const message = inspect(point, radius, allowPaintedOcclusion);
    if (message) findings.push({ id, message: `${id}: ${message}` });
  };
  for (const prop of art.props) {
    const object = document.objects.find((o) => o.id === prop.id);
    if (object?.kind !== 'prop' && object?.kind !== 'character') continue;
    if (prop.role === 'ground' || prop.role === 'attachment') continue;
    const radius = prop.footprint ? Math.hypot(...prop.footprint) / 2 : 0.3 * (prop.scale ?? 1);
    const interactive =
      area.interactables?.some((p) => p.object === prop.id) ||
      area.pickups?.some((p) => p.object === prop.id);
    check(prop.id, prop, radius, object.kind === 'prop' && !interactive);
  }
  for (const spawn of area.spawns) check(spawn.id, spawn, 0.3 + (spawn.jitterZ ?? 0));
  return findings;
}
