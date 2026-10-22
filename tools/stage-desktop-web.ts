import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { desktopWebOutput, webOutput, type BuildProfile } from './build-profile';
import { verifyBuildIdentity } from './build-identity';
import { fileChecksums } from './verified-files';

export async function stageDesktopWeb(profile: BuildProfile, root: string) {
  const artifact = await verifyBuildIdentity({ root, profile, target: 'web' });
  const from = webOutput(profile),
    to = desktopWebOutput(profile);
  await fs.rm(path.join(root, to), { recursive: true, force: true });
  await fs.cp(path.join(root, from), path.join(root, to), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
  const expected = Object.fromEntries(
    Object.entries(artifact.files).map(([file, hash]) => [to + file.slice(from.length), hash]),
  );
  assert.deepEqual(
    await fileChecksums(root, Object.keys(expected)),
    expected,
    'Desktop staging differs from the verified web artifact',
  );
}
