import { productionScenes } from './game-content';
export const liveLibraryAssets = [
  ...new Set(
    Object.values(productionScenes)
      .flatMap((scene) => scene.assets)
      .filter((id) => id.startsWith('library-')),
  ),
];
