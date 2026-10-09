import { gameAssetCatalog } from '../src/content/asset-catalog';
export async function readGameCatalog(_publicDirectory: string) {
  return gameAssetCatalog;
}
