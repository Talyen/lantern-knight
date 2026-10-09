import { assetCatalog, authoringBaseCatalog } from '../../src/content/asset-catalog';
import { readAsset } from './io';
import { safeRelative } from './paths';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function readAuthoringCatalog(
  publicDirectory?: string,
  options: { includeDeveloperAssets?: boolean } = {},
) {
  const library = JSON.parse(
    publicDirectory
      ? await fs.readFile(path.join(publicDirectory, 'generated/library/catalog.json'), 'utf8')
      : await readAsset('public/generated/library/catalog.json', 'utf8'),
  ) as Record<string, string>;
  for (const [id, file] of Object.entries(library)) {
    if (!/^library-[a-z0-9_-]+$/.test(id) || !safeRelative(file).startsWith('generated/library/'))
      throw new Error('Invalid prepared authoring catalog');
    if (id in authoringBaseCatalog) throw new Error('Authoring catalog overrides Game artwork');
  }
  return {
    ...(options.includeDeveloperAssets === false ? assetCatalog : authoringBaseCatalog),
    ...library,
  };
}
