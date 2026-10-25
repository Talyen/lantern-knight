import { itemArtAssets } from './item-art';
import orchard from '../../authoring/scenes/abandoned-orchard.json';
import clearing from '../../authoring/scenes/forest-gathering-clearing.json';
import forge from '../../authoring/scenes/ruined-forge.json';
import chapel from '../../authoring/scenes/desecrated-chapel.json';
import rootwood from '../../authoring/scenes/rootwood-clearing.json';
import village from '../../authoring/scenes/ruined-village-paths.json';
import graveyard from '../../authoring/scenes/graveyard-terraces.json';
import cloister from '../../authoring/scenes/cloister.json';
import abbey from '../../authoring/scenes/raven-abbey.json';
import crypt from '../../authoring/scenes/crypt.json';
import { resolveScene } from './world-art';
import { contentSnapshot, type ContentSnapshot } from './snapshot';
import { ContentRegistry, type ContentDefinitions } from './world';
import { sceneAssets, validateAreaArt, type WorldVisualDefinition } from './world-visuals';
import {
  ribLaneEffect,
  combatEffectAssets,
  packedCombatEffects,
  packedCombatManifest,
} from './combat-feedback';
import { visualEffectsAssets } from './visual-effects-assets';
import type { AreaDefinition } from './world';
import type { Manifest } from '../assets/schema';
import { actors } from './actors';
import { actorVisuals, assetCatalog } from './visuals';
import { validateSceneReferences } from './scene-document';
const playableScenes = [
  orchard,
  clearing,
  forge,
  chapel,
  rootwood,
  village,
  graveyard,
  cloister,
  abbey,
  crypt,
].map((document) => resolveScene(document));
export const worldVisuals: Readonly<Record<string, WorldVisualDefinition>> = Object.fromEntries(
  playableScenes.map((scene) => [scene.area.id, scene.visuals]),
);
export const contentDefinitions: ContentDefinitions = {
  initialArea: 'abandoned-orchard',
  player: 'lamplighter',
  actors,
  areas: playableScenes.map((scene) => scene.area),
};
for (const actor of contentDefinitions.actors) {
  const visual = actorVisuals[actor.visual];
  if (!visual || !assetCatalog[visual.asset])
    throw new Error(`content: unknown visual ${actor.visual}`);
}
export const content = new ContentRegistry(contentDefinitions);

type ResolvedArea = ContentSnapshot<{
  area: AreaDefinition;
  visuals?: WorldVisualDefinition;
  assets: readonly string[];
}>;
export type SceneContent = {
  readonly registry: ContentRegistry;
  readonly initialAssets: readonly string[];
  readonly area: (id: string) => ResolvedArea;
  readonly validate: (
    scene: ResolvedArea,
    packs: ReadonlyMap<string, { manifest: Manifest }>,
  ) => void;
};
/** Gameplay artwork requirements independent of authored geometry and rendering. */
export function areaGameplayAssets(
  registry: Pick<ContentRegistry, 'actor'>,
  area: Pick<AreaDefinition, 'spawns' | 'interactables'>,
) {
  return [
    ...(area.interactables?.length || area.spawns.some((s) => s.rewards?.length)
      ? ['library-lantern_concept_item_12_coin_purse']
      : []),
    ...(area.spawns.some((spawn) => registry.actor(spawn.actor).attack.kind === 'rib-lane')
      ? [ribLaneEffect.asset]
      : []),
    ...area.spawns.map((spawn) => actorVisuals[registry.actor(spawn.actor).visual]!.asset),
  ];
}
export function composeSceneContent(
  registry: ContentRegistry,
  visualsByArea: Readonly<Record<string, WorldVisualDefinition>>,
): SceneContent {
  const areas = new Map(
    registry.definitions.areas.map((area) => {
      const draft = visualsByArea[area.id];
      const visuals = draft ? contentSnapshot(draft) : undefined;
      return [
        area.id,
        Object.freeze({
          area,
          visuals,
          assets: Object.freeze([
            ...new Set([
              ...(visuals ? sceneAssets(visuals) : []),
              ...areaGameplayAssets(registry, area),
            ]),
          ]),
        }),
      ];
    }),
  );
  return Object.freeze<SceneContent>({
    registry,
    initialAssets: Object.freeze([
      ...new Set([
        actorVisuals[registry.actor(registry.definitions.player).visual]!.asset,
        ...visualEffectsAssets,
        ...combatEffectAssets,
      ]),
    ]),
    area: (id) => {
      const scene = areas.get(id);
      if (!scene) throw new Error('Unknown scene: ' + id);
      return scene;
    },
    validate: ({ area, visuals }, packs) => {
      validateAreaArt(packs, visuals);
      for (const object of area.interactables ?? []) {
        const placement = visuals?.props.find((p) => p.id === object.object);
        const manifest = placement && packs.get(placement.asset)?.manifest;
        if (
          !manifest ||
          [object.idle, object.action, object.spent].some((c) => !manifest.asset.clips[c])
        )
          throw new Error('Missing interaction animation: ' + object.id);
      }
      for (const spawn of area.spawns) {
        const visual = actorVisuals[registry.actor(spawn.actor).visual]!,
          manifest = packs.get(visual.asset)!.manifest;
        for (const name of [...Object.values(visual.clips), ...visual.attacks])
          if (!manifest.asset.clips[name]) throw new Error(`missing clip ${name}`);
        const contact = visual.attackContactDrawing;
        if (
          contact !== undefined &&
          (!Number.isInteger(contact) ||
            contact < 1 ||
            visual.attacks.some((name) =>
              Object.values(manifest.asset.clips[name]!).some(
                (clip) => clip && contact > clip.frames.length,
              ),
            ))
        )
          throw new Error(`Missing attack contact drawing: ${visual.asset}/${contact}`);
      }
    },
  });
}

const composedGameScenes = composeSceneContent(content, worldVisuals);
export const gameScenes: SceneContent = Object.freeze({
  ...composedGameScenes,
  validate(scene, packs) {
    composedGameScenes.validate(scene, packs);
    const source = playableScenes.find((s) => s.area.id === scene.area.id)!;
    validateSceneReferences(
      source.document,
      new Map([...packs].map(([id, p]) => [id, p.manifest])),
    );
  },
});
export const gameAssetCatalog: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ...new Set([
      ...itemArtAssets,
      ...gameScenes.initialAssets,
      ...content.definitions.areas.flatMap((area) => gameScenes.area(area.id).assets),
    ]),
  ].map((id) => {
    const file =
      (packedCombatEffects.includes(id) ? packedCombatManifest(id) : assetCatalog[id]) ??
      (/^library-[a-z0-9_-]+$/.test(id) ? `generated/library/${id}/manifest.json` : undefined);
    if (!file) throw new Error('Game requires an undeclared runtime asset: ' + id);
    return [id, file];
  }),
);
