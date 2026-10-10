import { authoredGameplay } from './authored-gameplay';
import { resolveFixtures } from './scenery-presets';
import { parseSceneDocument, resolveSceneDocument, type SceneDocument } from './scene-document';
import { isSupportedPosition, type AreaDefinition, type PropDefinition } from './world';
import { sceneAssets, SCENE_LIGHT_CAPACITY, type WorldVisualDefinition } from './world-visuals';
export function resolveAuthoredScene(document: SceneDocument): WorldVisualDefinition {
  const art = resolveSceneDocument(document);
  if (document.geometry) {
    const area: AreaDefinition = {
      id: document.base,
      name: document.name,
      subtitle: '',
      seedOffset: 0,
      spawns: [],
      exits: [],
      floorColor: 0,
      ...document.geometry,
      props: churchyardColliders(art),
    };
    for (const entry of area.entries)
      if (!isSupportedPosition(area, entry, 0.3))
        throw new Error('Scene entry is obstructed: ' + entry.id);
  }
  const resolvedFixtures = resolveFixtures(art);
  if (resolvedFixtures.length > SCENE_LIGHT_CAPACITY)
    throw new Error('The scene already has three lights. Remove a light before adding another.');
  return {
    ...art,
    resolvedFixtures,
    proceduralAssets: [
      ...new Set([
        ...art.proceduralAssets,
        ...resolvedFixtures.flatMap((f) => [
          ...(f.flame ? [f.flame.asset] : []),
          'fx-embers',
          ...(f.smoke ? ['fx-smoke'] : []),
        ]),
      ]),
    ],
  };
}
export function churchyardColliders(art: WorldVisualDefinition): PropDefinition[] {
  return [
    ...art.props
      .filter((p) => p.footprint)
      .map((p) => ({
        id: p.id,
        kind: 'wall' as const,
        x: p.x,
        z: p.z,
        radius: 0.2,
        height: 1,
        shape: 'box' as const,
        size: p.footprint,
        rotation: p.footprintAngle ?? 0,
        blocking: true,
      })),
    ...art.walls.map((w) => ({
      id: w.id,
      kind: 'wall' as const,
      x: (w.from.x + w.to.x) / 2,
      z: (w.from.z + w.to.z) / 2,
      radius: 0.2,
      height: w.height,
      shape: 'box' as const,
      size: [Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z), w.thickness] as const,
      rotation: Math.atan2(w.to.z - w.from.z, w.to.x - w.from.x),
      blocking: true,
    })),
  ];
}
export type ResolvedScene = {
  document: SceneDocument;
  area: AreaDefinition;
  visuals: WorldVisualDefinition;
  assets: readonly string[];
};
export function resolveScene(
  value: unknown,
  gameplay: Partial<
    Pick<AreaDefinition, 'subtitle' | 'seedOffset' | 'spawns' | 'exits' | 'floorColor'>
  > = {},
): ResolvedScene {
  const document = parseSceneDocument(value);
  const visuals = resolveAuthoredScene(document);
  const floor = document.floor;
  const geometry = document.geometry ?? {
    bounds: {
      minX: -floor!.width / 2,
      maxX: floor!.width / 2,
      minZ: -floor!.depth / 2,
      maxZ: floor!.depth / 2,
    },
    surface: { kind: 'flat' as const, height: 0 },
    baselineEntry: 'start',
    entries: [{ id: 'start', x: 0, z: 0 }],
  };
  let area: AreaDefinition = {
    id: document.base === 'flat' ? 'editor-flat' : document.base,
    name: document.name,
    subtitle: '',
    seedOffset: 0,
    spawns: [],
    exits: [],
    floorColor: 0x344b4e,
    ...geometry,
    ...gameplay,
    props: churchyardColliders(visuals),
  };
  area = authoredGameplay(document, area, visuals.props);
  return { document, area, visuals, assets: sceneAssets(visuals) };
}
