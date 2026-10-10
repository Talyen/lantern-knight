import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileChecksums } from './verified-files';
import assert from 'node:assert/strict';
import { contract } from '../src/core/camera';
import { content } from '../src/content/game-content';
import { worldVisuals } from '../src/content/game-content';
import { webOutput, electronOutput, type BuildProfile } from './build-profile';
import type { AssetWorkspace } from './assets/workspace';
import { sourceInputHash, type sourceFingerprint } from './source-identity';
const isOSMetadata = (name: string) => path.posix.basename(name) === '.DS_Store';
type ArtifactOptions = {
  root?: string;
  profile?: BuildProfile;
  report?: (message: string) => void;
  target?: 'web' | 'desktop';
};
async function artifactFiles(options: ArtifactOptions = {}) {
  const root = options.root ?? process.cwd(),
    report = options.report ?? console.log;
  const profile = options.profile ?? 'game',
    target = options.target ?? 'desktop',
    dist = webOutput(profile),
    electron = electronOutput(profile);
  const identityPath = `${dist}/build-identity.json`;
  // Finder can rewrite this after a build. It is not an application resource.

  async function files(directory: string): Promise<string[]> {
    const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
    return (
      await Promise.all(
        entries.map(async (e) => {
          const name = path.posix.join(directory, e.name);
          if (!e.isDirectory() && isOSMetadata(name)) return [];
          return e.isDirectory() ? files(name) : name === identityPath ? [] : [name];
        }),
      )
    )
      .flat()
      .sort();
  }
  const names = [
      ...(await files(dist)),
      ...(target === 'desktop' ? await files(electron) : []),
    ].sort(),
    checksums = await fileChecksums(root, names);
  return { root, report, target, identityPath, names, checksums };
}
export async function writeBuildIdentity(
  options: ArtifactOptions & {
    source: Awaited<ReturnType<typeof sourceFingerprint>>;
    assets: Pick<AssetWorkspace, 'identity' | 'recipe'>;
  },
) {
  const { root, report, target, identityPath, checksums } = await artifactFiles(options),
    inputs = options.source;
  assert.ok(
    inputs && /^[a-f0-9]{64}$/.test(inputs.sha256),
    'build identity requires a guarded build invocation',
  );
  const identity = {
    target,
    sourceCommit: inputs.commit,
    dirty: inputs.dirty,
    inputSha256: inputs.sha256,
    bundledDependencies: target === 'desktop',
    assets: {
      sha256: options.assets.identity,
      recipeSha256: options.assets.recipe,
      archiveRecipeSha256: options.assets.recipe,
    },
    files: checksums,
    rendering: {
      camera: contract,
      areas: Object.fromEntries(
        [...content.areas].map(([id, area]) => [
          id,
          { surface: area.surface, camera: worldVisuals[id]?.camera },
        ]),
      ),
    },
  };
  await fs.writeFile(path.join(root, identityPath), JSON.stringify(identity, null, 2) + '\n');
  report(`Build identity: ${inputs.commit}${inputs.dirty ? ' (working tree)' : ''}`);
  return identity;
}
export async function requireCurrentDesktopInputs(
  identity: { inputSha256: string },
  root = process.cwd(),
) {
  assert.equal(
    identity.inputSha256,
    await sourceInputHash(root, { scope: 'desktop' }),
    'Benchmark requires a fresh desktop package matching current build inputs',
  );
}
export async function verifyBuildIdentity(
  options: ArtifactOptions & { env?: NodeJS.ProcessEnv } = {},
) {
  const { root, report, target, identityPath, names, checksums } = await artifactFiles(options),
    env = options.env ?? process.env;

  const identity = JSON.parse(await fs.readFile(path.join(root, identityPath), 'utf8'));
  assert.equal(identity.target, target, `Rebuild the ${target} artifact before verification`);
  if (target === 'desktop')
    assert.equal(
      identity.bundledDependencies,
      true,
      'Rebuild with the current Electron dependency bundle guard before packaging',
    );
  const expected = Object.fromEntries(
    Object.entries(identity.files).filter(([name]) => !isOSMetadata(name)),
  );
  const changed = [...new Set([...Object.keys(checksums), ...Object.keys(expected)])].filter(
    (name) => checksums[name] !== expected[name],
  );
  if (changed.length)
    throw new Error(
      `build artifact files differ: ${changed.length} changed, missing or unexpected files\n` +
        changed.slice(0, 10).join('\n') +
        (changed.length > 10 ? '\nAdditional paths omitted.' : ''),
    );
  if (env.GITHUB_SHA) {
    assert.equal(identity.sourceCommit, env.GITHUB_SHA, 'artifact comes from another commit');
    assert.equal(identity.dirty, false, 'CI requires a clean source identity');
  }
  report(`PASS: build artifact identity and ${names.length} checksums.`);
  return identity;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--dev' && arg !== '--web'))
    throw new Error('Use build-identity [--dev] [--web]; build/package writes identities');
  verifyBuildIdentity({
    profile: process.argv.includes('--dev') ? 'authoring' : 'game',
    target: process.argv.includes('--web') ? 'web' : 'desktop',
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
