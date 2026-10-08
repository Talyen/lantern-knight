import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { contract } from '../src/core/camera';
import { content } from '../src/content/game-content';
import { worldVisuals } from '../src/content/world-art';
export async function buildIdentity(
  options: {
    root?: string;
    dev?: boolean;
    write?: boolean;
    env?: NodeJS.ProcessEnv;
    report?: (message: string) => void;
  } = {},
) {
  const root = options.root ?? process.cwd(),
    env = options.env ?? process.env,
    report = options.report ?? console.log;
  const dev = options.dev ?? false,
    dist = dev ? 'dist-dev' : 'dist',
    electron = dev ? 'dist-electron-dev' : 'dist-electron';
  const identityPath = `${dist}/build-identity.json`;
  // Finder can rewrite this after a build. It is not an application resource.
  const isOSMetadata = (name: string) => path.posix.basename(name) === '.DS_Store';
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
  const names = [...(await files(dist)), ...(await files(electron))].sort(),
    checksums = Object.fromEntries(
      await Promise.all(
        names.map(async (file) => [
          file,
          createHash('sha256')
            .update(await fs.readFile(path.join(root, file)))
            .digest('hex'),
        ]),
      ),
    );
  if (options.write) {
    const inputs = JSON.parse(env.LANTERN_BUILD_SOURCE ?? 'null') as {
      commit: string | null;
      dirty: boolean;
      sha256: string;
    } | null;
    assert.ok(
      inputs && /^[a-f0-9]{64}$/.test(inputs.sha256),
      'build identity requires a guarded build invocation',
    );
    await fs.writeFile(
      path.join(root, identityPath),
      JSON.stringify(
        {
          sourceCommit: inputs.commit,
          dirty: inputs.dirty,
          inputSha256: inputs.sha256,
          bundledDependencies: true,
          assets: {
            sha256: env.LANTERN_ASSET_SHA256 ?? null,
            recipeSha256: env.LANTERN_ASSET_RECIPE_SHA256 ?? null,
            archiveRecipeSha256: env.LANTERN_ASSET_ARCHIVE_RECIPE_SHA256 ?? null,
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
        },
        null,
        2,
      ) + '\n',
    );
    report(
      `Build identity: ${inputs.commit ?? 'source archive'}${inputs.dirty ? ' (working tree)' : ''}`,
    );
  } else {
    const identity = JSON.parse(await fs.readFile(path.join(root, identityPath), 'utf8'));
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
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildIdentity({
    dev: process.argv.includes('--dev'),
    write: process.argv.includes('--write'),
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
