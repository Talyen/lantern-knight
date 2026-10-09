import { webOutput, type BuildProfile } from './build-profile';
import { build as viteBuild } from 'vite';
import { openWorkspace } from './assets/workspace';
import { selectedFiles, copySelectedFiles } from './select-runtime-assets';
import { buildElectron } from './build-electron';
import { writeBuildIdentity } from './build-identity';
import { sourceFingerprint, sourceInputHash } from './source-identity';
import { projectRoot } from './assets/paths';
import { webConfig } from '../vite.config';
export async function buildWeb(profile: BuildProfile = 'game', local = false) {
  const started = performance.now(),
    workspace = await openWorkspace(
      local ? 'local' : 'pinned',
      profile === 'authoring' ? 'authoring' : 'runtime',
    );
  try {
    const source = await sourceFingerprint(projectRoot, { scope: 'web' });
    let stage = performance.now();
    const inventory = await selectedFiles(workspace.publicDirectory, profile);
    console.log(`Asset selection: ${Math.round(performance.now() - stage)}ms.`);
    stage = performance.now();
    await viteBuild({
      ...webConfig(workspace.publicDirectory, profile),
      configFile: false,
      mode: profile === 'authoring' ? 'sandbox' : 'production',
    });
    console.log(`Web compilation: ${Math.round(performance.now() - stage)}ms.`);
    stage = performance.now();
    await copySelectedFiles(workspace.publicDirectory, webOutput(profile), inventory);
    console.log(`Asset copy: ${Math.round(performance.now() - stage)}ms.`);
    stage = performance.now();
    if ((await sourceInputHash(projectRoot, { scope: 'web' })) !== source.sha256)
      throw new Error('Web inputs changed during compilation; rebuild');
    await writeBuildIdentity({
      profile,
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
export async function buildDesktop(profile: BuildProfile = 'game', local = false) {
  const desktopSource = await sourceFingerprint(projectRoot, { scope: 'desktop' });
  const inputs = await buildWeb(profile, local);
  const started = performance.now();
  await buildElectron(profile);
  console.log(`Electron compilation: ${Math.round(performance.now() - started)}ms.`);
  if ((await sourceInputHash(projectRoot, { scope: 'desktop' })) !== desktopSource.sha256)
    throw new Error('Desktop inputs changed during compilation; rebuild');
  await writeBuildIdentity({
    profile,
    target: 'desktop',
    ...inputs,
    source: desktopSource,
  });
}
