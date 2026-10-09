import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { restoreBuildAssets } from '../tools/build-assets';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
test('thin builds restore exact pinned media while rejecting wrong pins, tampering and unsafe paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-thin-build-'));
  const workspace = path.join(root, 'pin');
  try {
    await fs.mkdir(path.join(workspace, 'public/images'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'public/images/native.png'), 'native pixels');
    for (const dist of ['dist', 'dist-dev']) {
      await fs.mkdir(path.join(root, dist));
      await fs.writeFile(path.join(root, dist, 'index.js'), 'compiled code');
      await fs.writeFile(
        path.join(root, dist, 'build-identity.json'),
        JSON.stringify({
          sourceCommit: 'commit',
          dirty: false,
          assets: { sha256: 'pin' },
          files: {
            [`${dist}/images/native.png`]: hash('native pixels'),
            [`${dist}/index.js`]: hash('compiled code'),
          },
        }),
      );
    }
    await assert.rejects(restoreBuildAssets(root, workspace, 'wrong'), /another pin/);
    await assert.rejects(restoreBuildAssets(root, workspace, 'pin', 'wrong'), /another pin/);
    await restoreBuildAssets(root, workspace, 'pin', 'commit');
    assert.equal(
      await fs.readFile(path.join(root, 'dist/images/native.png'), 'utf8'),
      'native pixels',
    );
    assert.equal(await fs.readFile(path.join(root, 'dist/index.js'), 'utf8'), 'compiled code');
    await fs.writeFile(path.join(root, 'dist/images/native.png'), 'tampered');
    await assert.rejects(
      restoreBuildAssets(root, workspace, 'pin', 'commit'),
      /Build media differs/,
    );
    const identity = JSON.parse(
      await fs.readFile(path.join(root, 'dist/build-identity.json'), 'utf8'),
    );
    identity.files = { 'dist/../escape.png': hash('native pixels') };
    await fs.writeFile(path.join(root, 'dist/build-identity.json'), JSON.stringify(identity));
    await assert.rejects(restoreBuildAssets(root, workspace, 'pin', 'commit'), /Unsafe asset path/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
