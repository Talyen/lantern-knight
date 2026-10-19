import { assetClosure } from '../assets/asset-browser';
import type { Manifest } from '../assets/schema';
import { resolveSceneDocument, type SceneSnapshot } from '../content/scene-document';
import { sceneObjects } from '../content/campfire-visuals';
import { sceneAssetIds } from '../content/scene-placement';
import {
  contentDefinitions,
  content,
  gameScenes,
  areaGameplayAssets,
} from '../content/game-content';
import { actorVisuals } from '../content/visuals';

export type ReviewUsage = {
  roles: string[];
  clips: string[];
  objects: string[];
  points: { x: number; z: number }[];
};
export function reviewSceneAssets(
  document: SceneSnapshot,
  manifests: ReadonlyMap<string, Manifest>,
) {
  const source = contentDefinitions.areas.find((a) => a.id === document.base);
  const spawns = document.gameplay?.spawns ?? source?.spawns ?? [];
  const interactables = document.gameplay?.interactables ?? source?.interactables;
  const roots = new Set([
    ...gameScenes.initialAssets,
    ...areaGameplayAssets(content, { spawns, interactables }),
    ...sceneAssetIds(document),
    'ink-cues',
    ...((document.weather?.rain ?? 0) > 0 ? ['fx-splash', 'fx-ripple'] : []),
  ]);
  const usages = new Map<string, ReviewUsage>(
    [...assetClosure(roots, manifests)].map((id) => [
      id,
      { roles: [], clips: [], objects: [], points: [] },
    ]),
  );
  const add = (
    asset: string,
    role: string,
    point?: { x: number; z: number },
    object?: string,
    clip?: string,
  ) => {
    const usage = usages.get(asset) ?? { roles: [], clips: [], objects: [], points: [] };
    if (!usage.roles.includes(role)) usage.roles.push(role);
    if (point) usage.points.push({ x: point.x, z: point.z });
    if (object) usage.objects.push(object);
    if (clip && !usage.clips.includes(clip)) usage.clips.push(clip);
    usages.set(asset, usage);
  };
  add(document.floor.asset, 'Ground', undefined, undefined, document.floor.clip);
  const visuals = resolveSceneDocument(document as Parameters<typeof resolveSceneDocument>[0]);
  const placements = new Map([...visuals.props, ...visuals.decals].map((p) => [p.id, p]));
  const authored = new Set(document.objects.map((p) => p.id));
  const objects = sceneObjects(document);
  for (const object of objects) {
    add(
      object.asset,
      object.kind === 'character'
        ? 'Character'
        : object.kind === 'decal'
          ? 'Ground detail'
          : object.kind === 'effect'
            ? 'Effect'
            : 'Scenery',
      placements.get(object.id),
      authored.has(object.id) ? object.id : undefined,
      object.clip,
    );
  }
  for (const object of objects)
    if (object.fixture?.flame)
      add(
        object.fixture.flame.asset,
        'Fixture effect',
        undefined,
        undefined,
        object.fixture.flame.clip,
      );
  const hero = actorVisuals[content.actor(contentDefinitions.player).visual]!;
  add(hero.asset, 'Hero', document.hero, undefined, hero.clips.idle);
  for (const spawn of spawns) {
    const visual = actorVisuals[content.actor(spawn.actor).visual]!;
    add(visual.asset, 'Enemy', spawn, undefined, visual.clips.idle);
  }
  for (const layer of document.surround?.layers ?? []) add(layer.asset, 'Surround');
  for (const asset of document.proceduralAssets) add(asset, 'Procedural scenery');
  for (const [asset, usage] of usages)
    if (!usage.roles.length) usage.roles.push(roots.has(asset) ? 'Runtime effect' : 'Dependency');
  return usages;
}
