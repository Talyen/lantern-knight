import { assetCatalog, authoringBaseCatalog } from '../content/asset-catalog';
export async function authoringCatalog(signal?: AbortSignal) {
  const response = await fetch('/generated/library/catalog.json', { signal });
  if (!response.ok) throw new Error('Prepared authoring library is unavailable');
  const library = (await response.json()) as Record<string, string>;
  for (const [id, file] of Object.entries(library))
    if (
      !/^library-[a-z0-9_-]+$/.test(id) ||
      !/^generated\/library\/[a-z0-9_/-]+\.json$/.test(file) ||
      file.split('/').includes('..') ||
      id in authoringBaseCatalog
    )
      throw new Error('Invalid prepared authoring catalog');
  return { ...authoringBaseCatalog, ...library };
}
export async function gameCatalog() {
  return assetCatalog;
}
