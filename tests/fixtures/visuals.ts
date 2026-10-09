import type { WorldVisualDefinition } from '../../src/content/world-art';
import { developerScenes } from '../../src/content/developer-scenes';
import { ContentRegistry } from '../../src/content/world';
import { actors } from '../../src/content/actors';
export const worldVisuals: Record<string, WorldVisualDefinition> = {
  court: developerScenes[0]!.visuals,
  'upper-landing': developerScenes[1]!.visuals,
};
export const content = new ContentRegistry({
  initialArea: 'court',
  player: 'lamplighter',
  actors,
  areas: developerScenes.map((scene, i) => ({ ...scene.area, id: i ? 'upper-landing' : 'court' })),
});
