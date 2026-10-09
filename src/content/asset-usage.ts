import { composeSceneContent, content, contentDefinitions, worldVisuals } from './game-content';
import { developerVisuals } from './developer-scenes';
import { sandboxContent, sandboxDefinitions } from './sandbox-world';
import { playgroundCatalog } from './effects-playground-assets';
import { resolveScene } from './world-art';
import type { SceneDocument } from './scene-document';
import { actorVisuals } from './visuals';
export function fixtureAssetRoots(area: string) {
  if (area === 'effects-playground') return new Set(Object.keys(playgroundCatalog));
  const scenes = composeSceneContent(sandboxContent, developerVisuals);
  return new Set([...scenes.initialAssets, ...scenes.area(area).assets]);
}
export function usedAssetRoots() {
  const roots = new Set(Object.keys(playgroundCatalog));
  for (const [registry, visuals] of [
    [content, worldVisuals],
    [sandboxContent, developerVisuals],
  ] as const) {
    const scenes = composeSceneContent(registry, visuals);
    for (const id of scenes.initialAssets) roots.add(id);
    for (const area of registry.definitions.areas)
      for (const id of scenes.area(area.id).assets) roots.add(id);
  }
  return roots;
}
export function documentAssetRoots(document: SceneDocument) {
  const source = sandboxDefinitions.areas.find((area) => area.id === document.base);
  const resolved = resolveScene(
    document,
    source ? { spawns: source.spawns, exits: source.exits } : {},
  );
  const roots = new Set(resolved.assets);
  roots.add(actorVisuals[content.actor(contentDefinitions.player).visual]!.asset);
  for (const spawn of resolved.area.spawns) {
    const actor = sandboxContent.actor(spawn.actor);
    roots.add(actorVisuals[actor.visual]!.asset);
  }
  return roots;
}
