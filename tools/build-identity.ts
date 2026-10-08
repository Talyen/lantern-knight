import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { contract } from '../src/core/camera';
import { content } from '../src/content/game-content';
import { worldVisuals } from '../src/content/world-art';
const dev = process.argv.includes('--dev'),
  dist = dev ? 'dist-dev' : 'dist',
  electron = dev ? 'dist-electron-dev' : 'dist-electron';
const identityPath = `${dist}/build-identity.json`;
// Finder can rewrite this after a build. It is not an application resource.
const isOSMetadata = (name: string) => path.posix.basename(name) === '.DS_Store';
async function files(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
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
          .update(await fs.readFile(file))
          .digest('hex'),
      ]),
    ),
  );
if (process.argv.includes('--write')) {
  const inputs = JSON.parse(process.env.LANTERN_BUILD_SOURCE ?? 'null') as {
    commit: string | null;
    dirty: boolean;
    sha256: string;
  } | null;
  assert.ok(
    inputs && /^[a-f0-9]{64}$/.test(inputs.sha256),
    'build identity requires a guarded build invocation',
  );
  await fs.writeFile(
    identityPath,
    JSON.stringify(
      {
        sourceCommit: inputs.commit,
        dirty: inputs.dirty,
        inputSha256: inputs.sha256,
        bundledDependencies: true,
        assets: {
          sha256: process.env.LANTERN_ASSET_SHA256 ?? null,
          recipeSha256: process.env.LANTERN_ASSET_RECIPE_SHA256 ?? null,
          archiveRecipeSha256: process.env.LANTERN_ASSET_ARCHIVE_RECIPE_SHA256 ?? null,
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
  console.log(
    `Build identity: ${inputs.commit ?? 'source archive'}${inputs.dirty ? ' (working tree)' : ''}`,
  );
} else {
  const identity = JSON.parse(await fs.readFile(identityPath, 'utf8'));
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
  if (process.env.GITHUB_SHA) {
    assert.equal(
      identity.sourceCommit,
      process.env.GITHUB_SHA,
      'artifact comes from another commit',
    );
    assert.equal(identity.dirty, false, 'CI requires a clean source identity');
  }
  console.log(`PASS: build artifact identity and ${names.length} checksums.`);
}
