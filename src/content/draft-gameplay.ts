import {
  ContentRegistry,
  type ContentDefinitions,
  type AreaDefinition,
  isSupportedPosition,
} from './world';
import { type SceneDocument, parseSceneDocument, validateSceneReferences } from './scene-document';
import {
  resolveAuthoredScene,
  churchyardColliders,
  sceneAssets,
  type WorldVisualDefinition,
} from './world-art';
import { authoredGameplay } from './authored-gameplay';
import { actorVisuals } from './visuals';
import { visualEffectsAssets } from './visual-effects-assets';
import type { SceneContent } from './game-content';
import { validateAreaArt } from './world-art';
export function composeDraftGameplay(
  value: unknown,
  definitions: ContentDefinitions,
  visualsByArea: Readonly<Record<string, WorldVisualDefinition>>,
) {
  const document = parseSceneDocument(value),
    visuals = resolveAuthoredScene(document);
  const source = definitions.areas.find((a) => a.id === document.base);
  const geometry = document.geometry ?? {
    bounds: {
      minX: -document.floor.width / 2,
      maxX: document.floor.width / 2,
      minZ: -document.floor.depth / 2,
      maxZ: document.floor.depth / 2,
    },
    surface: { kind: 'flat' as const, height: 0 },
    baselineEntry: 'start',
    entries: [{ id: 'start', x: 0, z: 0 }],
  };
  let area: AreaDefinition = {
    id: document.base,
    name: document.name,
    subtitle: 'Draft playtest',
    seedOffset: source?.seedOffset ?? 0,
    floorColor: 0x344b4e,
    spawns: source?.spawns ?? [],
    exits: source?.exits ?? [],
    ...geometry,
    props: churchyardColliders(document.base, visuals),
  };
  area = authoredGameplay(document, area);
  if (area.pickups)
    area = {
      ...area,
      pickups: area.pickups.map((p) => {
        const object = visuals.props.find((v) => v.id === p.object);
        return object ? { ...p, x: object.x, z: object.z } : p;
      }),
    };
  const registry = new ContentRegistry({
    ...definitions,
    initialArea: area.id,
    areas: [...definitions.areas.filter((p) => p.id !== area.id), area],
  });
  for (const p of [document.hero, ...area.spawns])
    if (!isSupportedPosition(area, p, 0.3))
      throw new Error('Gameplay placement is outside the playable surface or obstructed');
  const map = { ...visualsByArea, [area.id]: visuals };
  const scenes: SceneContent = {
    initialAssets: [
      ...new Set([
        actorVisuals[registry.actor(registry.definitions.player).visual]!.asset,
        ...visualEffectsAssets,
      ]),
    ],
    area: (id) => {
      const a = registry.area(id),
        art = map[id];
      return {
        area: a,
        visuals: art,
        assets: [
          ...new Set([
            ...(art ? [...sceneAssets(art), 'ink-cues'] : []),
            ...a.spawns.map((p) => actorVisuals[registry.actor(p.actor).visual]!.asset),
          ]),
        ],
      };
    },
    validate: ({ area, visuals }, packs) => {
      validateAreaArt(area, packs, visuals);
      if (area.id === document.base)
        validateSceneReferences(document, new Map([...packs].map(([id, p]) => [id, p.manifest])));
    },
  };
  return { document, registry, scenes };
}
export function withGameplayDefaults(
  document: SceneDocument,
  definitions: ContentDefinitions,
): SceneDocument {
  if (document.gameplay) return document;
  const source = definitions.areas.find((p) => p.id === document.base);
  return {
    ...document,
    gameplay: {
      spawns: structuredClone([...(source?.spawns ?? [])]),
      exits: structuredClone([...(source?.exits ?? [])]),
      pickups: structuredClone([...(source?.pickups ?? [])]),
    },
  };
}
