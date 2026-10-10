import { ContentRegistry, type ContentDefinitions, isSupportedPosition } from './world';
import { type SceneDocument, parseSceneDocument, validateSceneReferences } from './scene-document';
import { resolveScene } from './world-art';
import { type WorldVisualDefinition } from './world-visuals';
import { composeSceneContent } from './game-content';
export function composeDraftGameplay(
  value: unknown,
  definitions: ContentDefinitions,
  visualsByArea: Readonly<Record<string, WorldVisualDefinition>>,
) {
  const document = parseSceneDocument(value);
  const source = definitions.areas.find((a) => a.id === document.base);
  const { area, visuals } = resolveScene(
    document,
    source ? { spawns: source.spawns, exits: source.exits, seedOffset: source.seedOffset } : {},
  );
  const registry = new ContentRegistry({
    ...definitions,
    initialArea: area.id,
    areas: [...definitions.areas.filter((p) => p.id !== area.id), area],
  });
  const placements = [
    { ...document.hero, radius: registry.actor(definitions.player).radius },
    ...area.spawns.map((p) => ({ ...p, radius: registry.actor(p.actor).radius })),
  ];
  for (const p of placements)
    if (!isSupportedPosition(area, p, p.radius))
      throw new Error('Gameplay placement is outside the playable surface or obstructed');
  const scenes = composeSceneContent(registry, { ...visualsByArea, [area.id]: visuals });
  const validate = scenes.validate;
  scenes.validate = (scene, packs) => {
    validate(scene, packs);
    if (scene.area.id === area.id)
      validateSceneReferences(document, new Map([...packs].map(([id, p]) => [id, p.manifest])));
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
