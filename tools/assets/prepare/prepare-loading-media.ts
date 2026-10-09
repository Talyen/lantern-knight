import path from 'node:path';

import { projectRoot } from '../paths';

import { loadingVideoPath } from '../../../src/content/loading-media';
import { validateLoadingVideo } from '../loading-media';
import type { PreparationContext } from '../context';
export async function prepare(context: PreparationContext, check = false) {
  const { readLibrarySource, readAsset, writeAsset } = context;

  const original = await readLibrarySource('Lantern_C_LastFerry_Preview.mp4', 'last-ferry', {
    root: context.libraryRoot,
    indexPath: path.join(projectRoot, 'assets/loading-sources.json'),
  });
  validateLoadingVideo(original);
  if (check) {
    validateLoadingVideo(await readAsset('public/' + loadingVideoPath));
  } else await writeAsset('public/' + loadingVideoPath, original);
  console.log('Last Ferry loading video: exact original bytes verified.');
}
