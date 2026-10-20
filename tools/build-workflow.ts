import { onAsyncExit } from './scope-exit';
import { webOutput, type BuildProfile } from './build-profile';
import { build as viteBuild } from 'vite';
import { openWorkspace } from './assets/workspace';
import { selectedFiles, copySelectedFiles } from './select-runtime-assets';
import { buildElectron } from './build-electron';
import { verifyBuildIdentity, writeBuildIdentity } from './build-identity';
import assert from 'node:assert/strict';
import { sourceFingerprint, sourceInputHash } from './source-identity';
import { projectRoot } from './assets/paths';
import { webConfig } from '../vite.config';
export async function buildWeb(profile: BuildProfile = 'game', local = false, eager = false) {
  const started = performance.now(),
    workspace = await openWorkspace(
      local ? 'local' : 'pinned',
      'authoring',
      profile === 'game' && !eager,
    );
  await using _cleanup1 = onAsyncExit(() => workspace.release());
  const source = await sourceFingerprint(projectRoot, { scope: 'web' });
  let stage = performance.now();
  const inventory = await selectedFiles(
    workspace.publicDirectory,
    profile,
    workspace.ensurePublicFile,
  );
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
}
export async function buildDesktop(
  profile: BuildProfile = 'game',
  local = false,
  prebuiltWeb = false,
) {
  if (prebuiltWeb && local) throw new Error('Prebuilt web assets cannot use --local');
  const desktopSource = await sourceFingerprint(projectRoot, { scope: 'desktop' });
  const inputs = prebuiltWeb
    ? await (async () => {
        const artifact = await verifyBuildIdentity({ profile, target: 'web' });
        assert.equal(
          artifact.inputSha256,
          await sourceInputHash(projectRoot, { scope: 'web' }),
          'Prebuilt web inputs differ; rebuild before packaging',
        );
        return {
          assets: { identity: artifact.assets.sha256, recipe: artifact.assets.recipeSha256 },
        };
      })()
    : await buildWeb(profile, local);
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
