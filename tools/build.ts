import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { openWorkspace, workspaceEnvironment } from './assets/workspace';
import { selectedFiles, copySelectedFiles } from './select-runtime-assets';
import { buildElectron } from './build-electron';
import { buildIdentity } from './build-identity';
import { sourceFingerprint } from './source-identity';
import { projectRoot } from './assets/paths';
export async function build(dev = false, local = false) {
  const started = performance.now(),
    workspace = await openWorkspace(local ? 'local' : 'pinned', dev ? 'authoring' : 'runtime');
  try {
    const source = await sourceFingerprint(projectRoot, { scope: 'runtime' });
    const inventory = await selectedFiles(path.join(workspace.root, 'public'), dev);
    await viteBuild({
      mode: dev ? 'sandbox' : 'production',
      publicDir: path.join(workspace.root, 'public'),
      build: { copyPublicDir: false },
    });
    await copySelectedFiles(
      path.join(workspace.root, 'public'),
      dev ? 'dist-dev' : 'dist',
      inventory,
    );
    await buildElectron(dev);
    await buildIdentity({
      dev,
      write: true,
      env: { ...workspaceEnvironment(workspace), LANTERN_BUILD_SOURCE: JSON.stringify(source) },
    });
    console.log(
      `Build: ${inventory.files.length} selected files; ${(inventory.bytes / 1024 ** 2).toFixed(1)} MiB; ${Math.round(performance.now() - started)}ms.`,
    );
  } finally {
    await workspace.release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => !['--dev', '--local'].includes(arg)))
    throw new Error('Use build [--dev] [--local]');
  build(process.argv.includes('--dev'), process.argv.includes('--local')).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
