import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { openWorkspace } from '../../tools/assets/workspace';
import { checkAssets } from '../../tools/check-assets';
import { developmentServer } from '../../tools/dev';

test('explicit pinned workspaces validate without ambient paths and failed previews release their lease', async () => {
  const workspace = await openWorkspace('pinned', 'runtime');
  const prior = process.env.LANTERN_ASSET_WORKSPACE;
  const reservation = net.createServer();
  try {
    assert.equal(workspace.publicDirectory, path.join(workspace.root, 'public'));
    assert.equal(workspace.metadataDirectory, path.join(workspace.root, 'metadata'));
    process.env.LANTERN_ASSET_WORKSPACE = '/missing-ambient-workspace';
    await checkAssets(workspace);
    const leases = path.join(workspace.root, '.leases');
    const before = (await fs.readdir(leases)).sort();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as net.AddressInfo).port;
    await assert.rejects(
      developmentServer({ port, pinned: true, runtime: true }),
      /already in use/,
    );
    assert.deepEqual((await fs.readdir(leases)).sort(), before);
  } finally {
    if (prior === undefined) delete process.env.LANTERN_ASSET_WORKSPACE;
    else process.env.LANTERN_ASSET_WORKSPACE = prior;
    if (reservation.listening)
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
    await workspace.release();
  }
});
