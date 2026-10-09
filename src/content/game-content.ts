import { authoredGameplay } from './authored-gameplay';
import courtDocument from '../../authoring/scenes/live-court.json';
import chapelDocument from '../../authoring/scenes/live-upper-landing.json';
import { parseSceneDocument } from './scene-document';
import { ContentRegistry, type ContentDefinitions } from './world';
import {
  churchyardColliders,
  worldVisuals,
  sceneAssets,
  validateAreaArt,
  type WorldVisualDefinition,
} from './world-art';
import { visualEffectsAssets } from './visual-effects-assets';
import type { AreaDefinition } from './world';
import type { Manifest } from '../assets/schema';
import { tuning } from './gameplay';
import { actorVisuals, assetCatalog } from './visuals';
const courtScene = parseSceneDocument(courtDocument);
const courtGeometry = courtScene.geometry!;
const chapelScene = parseSceneDocument(chapelDocument);
const chapelGeometry = chapelScene.geometry!;
export const contentDefinitions: ContentDefinitions = {
  initialArea: 'court',
  player: 'lamplighter',
  actors: [
    {
      id: 'skeleton',
      kind: 'enemy',
      maxHealth: 50,
      radius: 0.25,
      speed: 0.9,
      melee: { windup: 39, activeEnd: 43, total: 68, range: 1.2, halfAngle: 1.1, damage: 8 },
      visual: 'skeleton',
    },
    {
      id: 'lamplighter',
      kind: 'hero',
      maxHealth: tuning.heroMaxHealth,
      radius: tuning.heroRadius,
      speed: tuning.moveSpeed,
      melee: { ...tuning.attack },
      visual: 'hero',
    },
  ],
  areas: [
    {
      id: 'court',
      name: 'Graveyard Approach',
      subtitle: 'A worn path leads between the graves to the chapel.',
      ...courtGeometry,
      seedOffset: 0,
      spawns: [{ id: 'warden-1', actor: 'skeleton', x: 0.7, z: 0.0 }],
      props: churchyardColliders('court'),
      floorColor: 0x34434a,
      exits: [
        {
          id: 'landing',
          trigger: { minX: -0.95, maxX: 0.95, minZ: -6.3, maxZ: -5.75 },
          destination: 'upper-landing',
          entry: 'start',
          requiresClear: true,
          marker: { x: 0, z: -6.15 },
        },
      ],
    },
    {
      id: 'upper-landing',
      name: 'Ruined Chapel',
      subtitle: 'The restless dead gather in the ruined nave.',
      ...chapelGeometry,
      seedOffset: 101,
      spawns: [
        { id: 'warden-1', actor: 'skeleton', x: -2.0, z: 1.0 },
        { id: 'warden-2', actor: 'skeleton', x: 1.7, z: -1.3 },
      ],
      props: churchyardColliders('upper-landing'),
      floorColor: 0x3e444e,
      exits: [
        {
          id: 'court',
          trigger: { minX: -0.95, maxX: 0.95, minZ: 8.1, maxZ: 8.7 },
          destination: 'court',
          entry: 'from-landing',
          requiresClear: false,
          marker: { x: 0, z: 9 },
        },
      ],
    },
  ],
};
contentDefinitions.areas = contentDefinitions.areas.map((area) =>
  authoredGameplay(
    area.id === 'court' ? courtScene : chapelScene,
    area,
    worldVisuals[area.id]?.props,
  ),
);
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
export function composeSceneContent(registry: ContentRegistry): SceneContent {
  const areas = new Map(
    registry.definitions.areas.map((area) => {
      const visuals = worldVisuals[area.id];
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
