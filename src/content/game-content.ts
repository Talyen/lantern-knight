import { ContentRegistry, type ContentDefinitions } from './world';
import { sceneAssets, validateAreaArt, type WorldVisualDefinition } from './world-art';
import { visualEffectsAssets } from './visual-effects-assets';
import type { AreaDefinition } from './world';
import type { Manifest } from '../assets/schema';
import { actors } from './actors';
import { actorVisuals, assetCatalog } from './visuals';
export const worldVisuals: Readonly<Record<string, WorldVisualDefinition>> = {};
export const contentDefinitions: ContentDefinitions = {
  initialArea: 'empty',
  player: 'lamplighter',
  actors,
  areas: [
    {
      id: 'empty',
      name: 'Empty scene',
      subtitle: 'A blank space for prototype development.',
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      surface: { kind: 'flat', height: 0 },
      seedOffset: 0,
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 0 }],
      spawns: [],
      props: [],
      exits: [],
      floorColor: 0x34434a,
    },
  ],
};
for (const actor of contentDefinitions.actors) {
  const visual = actorVisuals[actor.visual];
  if (!visual || !assetCatalog[visual.asset])
    throw new Error(`content: unknown visual ${actor.visual}`);
}
export const content = new ContentRegistry(contentDefinitions);

type ResolvedArea = {
  area: AreaDefinition;
  visuals?: WorldVisualDefinition;
  assets: readonly string[];
};
export type SceneContent = {
  initialAssets: readonly string[];
  area: (id: string) => ResolvedArea;
  validate: (scene: ResolvedArea, packs: ReadonlyMap<string, { manifest: Manifest }>) => void;
};
export function composeSceneContent(
  registry: ContentRegistry,
  visualsByArea: Readonly<Record<string, WorldVisualDefinition>>,
): SceneContent {
  const areas = new Map(
    registry.definitions.areas.map((area) => {
      const visuals = visualsByArea[area.id];
      return [
        area.id,
        {
          area,
          visuals,
          assets: [
            ...new Set([
              ...(visuals ? sceneAssets(visuals) : []),
              ...area.spawns.map(
                (spawn) => actorVisuals[registry.actor(spawn.actor).visual]!.asset,
              ),
            ]),
          ],
        },
      ];
    }),
  );
  return {
    initialAssets: [
      ...new Set([
        actorVisuals[registry.actor(registry.definitions.player).visual]!.asset,
        ...visualEffectsAssets,
      ]),
    ],
    area: (id) => {
      const scene = areas.get(id);
      if (!scene) throw new Error('Unknown scene: ' + id);
      return scene;
    },
    validate: ({ area, visuals }, packs) => {
      validateAreaArt(area, packs, visuals);
      for (const spawn of area.spawns) {
        const visual = actorVisuals[registry.actor(spawn.actor).visual]!,
          manifest = packs.get(visual.asset)!.manifest;
        for (const name of [...Object.values(visual.clips), ...visual.attacks])
          if (!manifest.asset.clips[name]) throw new Error(`missing clip ${name}`);
      }
    },
  };
}
