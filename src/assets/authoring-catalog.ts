import { assetCatalog } from '../content/asset-catalog';
import { liveLibraryAssets } from '../content/library-references';
export async function authoringCatalog() {
  const response = await fetch('/generated/library/catalog.json');
  if (!response.ok) throw new Error('Prepared authoring library is unavailable');
  const library = (await response.json()) as Record<string, string>;
  for (const [id, file] of Object.entries(library))
    if (
      !/^library-[a-z0-9_-]+$/.test(id) ||
      !/^generated\/library\/[a-z0-9_/-]+\.json$/.test(file) ||
      file.split('/').includes('..') ||
      id in assetCatalog
    )
      throw new Error('Invalid prepared authoring catalog');
  return { ...assetCatalog, ...library };
}
export async function gameCatalog() {
  if (!liveLibraryAssets.length) return assetCatalog;
  const library = await authoringCatalog();
  return {
    ...assetCatalog,
    ...Object.fromEntries(
      liveLibraryAssets.map((id) => {
        const file = library[id];
        if (!file) throw new Error('Live scene artwork unavailable: ' + id);
        return [id, file];
      }),
    ),
  };
}
