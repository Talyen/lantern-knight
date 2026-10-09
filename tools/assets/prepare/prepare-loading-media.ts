import path from 'node:path';
import os from 'node:os';
import { readLibrarySource } from '../sources';
import { projectRoot } from '../paths';
import { readAsset, writeAsset } from '../io';
import { loadingVideoPath } from '../../../src/content/loading-media';
import { validateLoadingVideo } from '../loading-media';

const original = await readLibrarySource('Lantern_C_LastFerry_Preview.mp4', 'last-ferry', {
  root: process.env.ASSET_LIBRARY_ROOT ?? path.join(os.homedir(), 'Documents', 'Asset Library'),
  indexPath: path.join(projectRoot, 'assets/loading-sources.json'),
});
validateLoadingVideo(original);
if (process.argv.includes('--check')) {
  validateLoadingVideo(await readAsset('public/' + loadingVideoPath));
} else await writeAsset('public/' + loadingVideoPath, original);
console.log('Last Ferry loading video: exact original bytes verified.');
