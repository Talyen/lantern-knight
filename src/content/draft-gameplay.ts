import { AuthoredGameplaySchema } from './authored-gameplay';
import { ContentRegistry, type ContentDefinitions } from './world';
import { type SceneDocument, parseSceneDocument, validateSceneReferences } from './scene-document';
import { resolveScene } from './world-art';
import { type WorldVisualDefinition } from './world-visuals';
import { composeSceneContent, type SceneContent } from './game-content';
export function composeDraftGameplay(
  value: unknown,
  definitions: ContentDefinitions,
  visualsByArea: Readonly<Record<string, WorldVisualDefinition>>,
) {
  const document = parseSceneDocument(value);
  const source = definitions.areas.find((a) => a.id === document.base);
  const { area, visuals } = resolveScene(
    document,
    source
      ? {
          spawns: source.spawns,
          exits: source.exits,
          pickups: source.pickups,
          campfires: source.campfires,
          interactables: source.interactables,
          seedOffset: source.seedOffset,
        }
      : {},
  );
  const registry = new ContentRegistry({
    ...definitions,
    initialArea: area.id,
    areas: [...definitions.areas.filter((p) => p.id !== area.id), area],
  });
  const validationDocument = structuredClone(document);
  const scenes = composeSceneContent(registry, { ...visualsByArea, [area.id]: visuals });
  return {
    document,
    registry,
    scenes: Object.freeze<SceneContent>({
      ...scenes,
      validate(scene, packs) {
        scenes.validate(scene, packs);
        if (scene.area.id === area.id)
          validateSceneReferences(
            validationDocument,
            new Map([...packs].map(([id, p]) => [id, p.manifest])),
          );
      },
    }),
  };
}

export function withGameplayDefaults(
  document: SceneDocument,
  definitions: ContentDefinitions,
): SceneDocument {
  if (document.gameplay) return document;
  const source = definitions.areas.find((p) => p.id === document.base);
  return {
    ...document,
    gameplay: AuthoredGameplaySchema.parse({
      spawns: structuredClone([...(source?.spawns ?? [])]),
      exits: structuredClone([...(source?.exits ?? [])]),
      pickups: structuredClone([...(source?.pickups ?? [])]),
      campfires: source?.campfires,
      interactables: source?.interactables,
    }),
  };
}
