import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { openWorkspace } from './assets/workspace';
import { selectedFiles, copySelectedFiles } from './select-runtime-assets';
import { buildElectron } from './build-electron';
import { buildIdentity } from './build-identity';
import { sourceFingerprint } from './source-identity';
import { projectRoot } from './assets/paths';
import { webConfig } from '../vite.config';
async function build(dev = false, local = false) {
  const started = performance.now(),
    workspace = await openWorkspace(local ? 'local' : 'pinned', dev ? 'authoring' : 'runtime');
  try {
    const source = await sourceFingerprint(projectRoot, { scope: 'runtime' });
    let stage = performance.now();
    const inventory = await selectedFiles(workspace.publicDirectory, dev);
    console.log(`Asset selection: ${Math.round(performance.now() - stage)}ms.`);
    stage = performance.now();
    await viteBuild({
      ...webConfig(workspace.publicDirectory, dev),
      configFile: false,
      mode: dev ? 'sandbox' : 'production',
    });
    console.log(`Web compilation: ${Math.round(performance.now() - stage)}ms.`);
    stage = performance.now();
    await copySelectedFiles(workspace.publicDirectory, dev ? 'dist-dev' : 'dist', inventory);
    console.log(`Asset copy: ${Math.round(performance.now() - stage)}ms.`);
    stage = performance.now();
    await buildIdentity({
      dev,
      write: true,
      target: 'web',
      source,
      assets: workspace,
    });
    console.log(`Web identity: ${Math.round(performance.now() - stage)}ms.`);
    console.log(
      `Build: ${inventory.files.length} selected files; ${(inventory.bytes / 1024 ** 2).toFixed(1)} MiB; ${Math.round(performance.now() - started)}ms.`,
    );
    return { source, assets: { identity: workspace.identity, recipe: workspace.recipe } };
  } finally {
    await workspace.release();
  }
}
export async function buildDesktop(dev = false, local = false) {
  const inputs = await build(dev, local);
  const started = performance.now();
  await buildElectron(dev);
  console.log(`Electron compilation: ${Math.round(performance.now() - started)}ms.`);
  await buildIdentity({ dev, write: true, target: 'desktop', ...inputs });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => !['--dev', '--local'].includes(arg)))
    throw new Error('Use build [--dev] [--local]');
  build(process.argv.includes('--dev'), process.argv.includes('--local')).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
