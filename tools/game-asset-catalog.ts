import { gameAssetCatalog } from '../src/content/asset-catalog';
import { liveLibraryAssets } from '../src/content/library-references';
import { readAuthoringCatalog } from './assets/authoring-catalog';
export async function readGameCatalog() {
  if (!liveLibraryAssets.length) return gameAssetCatalog;
  const library = await readAuthoringCatalog();
  return {
    ...gameAssetCatalog,
    ...Object.fromEntries(
      liveLibraryAssets.map((id) => {
        const file = library[id];
        if (!file) throw new Error('Live scene artwork unavailable: ' + id);
        return [id, file];
      }),
    ),
  };
}
