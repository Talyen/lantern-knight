import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
import { openWorkspace } from '../../tools/assets/workspace';
import { checkAssets } from '../../tools/check-assets';
import { openPreview } from '../../tools/preview-session';
import { checkSceneDocuments } from '../../tools/check-scene-documents';
import { selectedFiles } from '../../tools/select-runtime-assets';
import { emptyScene } from '../../src/editor/default-scene';
import { assetCatalog } from '../../src/content/asset-catalog';

test('explicit pinned workspaces validate without ambient paths and failed previews release their lease', async () => {
  const workspace = await openWorkspace('pinned', 'runtime');
  const prior = process.env.LANTERN_ASSET_WORKSPACE;
  const sockets = new Set<net.Socket>();
  const reservation = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
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
      openPreview({ output: 'development', assets: 'pinned', scope: 'runtime', port }),
      /occupied/,
    );
    assert.deepEqual((await fs.readdir(leases)).sort(), before);
  } finally {
    if (prior === undefined) delete process.env.LANTERN_ASSET_WORKSPACE;
    else process.env.LANTERN_ASSET_WORKSPACE = prior;
    for (const socket of sockets) socket.destroy();
    if (reservation.listening)
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
    await workspace.release();
  }
});

test('preview reuse verifies identity and releases only its own lease', async () => {
  const workspace = await openWorkspace('pinned', 'runtime');
  const identity = {
    root: await fs.realpath(process.cwd()),
    assets: workspace.identity,
    target: 'development',
    scope: 'runtime',
  };
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(identity));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  try {
    const leases = path.join(workspace.root, '.leases'),
      before = (await fs.readdir(leases)).sort();
    const session = await openPreview({
      output: 'development',
      assets: 'pinned',
      scope: 'runtime',
      port,
      reuse: true,
    });
    await session.close();
    await session.close();
    assert.equal(server.listening, true);
    assert.deepEqual((await fs.readdir(leases)).sort(), before);
    identity.assets = '0'.repeat(64);
    await assert.rejects(
      openPreview({ output: 'development', assets: 'pinned', scope: 'runtime', port, reuse: true }),
      /another checkout or asset identity/,
    );
    assert.deepEqual((await fs.readdir(leases)).sort(), before);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await workspace.release();
  }
});

test('Game artifacts omit unused art while runtime delivery and authored scenes retain it', async () => {
  const workspace = await openWorkspace('pinned', 'authoring');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-authored-assets-'));
  try {
    const game = await selectedFiles(workspace.publicDirectory, 'game'),
      runtime = await selectedFiles(workspace.publicDirectory, 'runtime'),
      floor = assetCatalog['ink-moss']!;
    assert.equal(game.files.includes(floor), false);
    assert.equal(runtime.files.includes(floor), true);
    assert.ok(game.bytes < runtime.bytes);
    await checkSceneDocuments(process.cwd(), workspace.publicDirectory);
    const directory = path.join(root, 'authoring/scenes');
    await fs.mkdir(directory, { recursive: true });
    const document = emptyScene();
    await fs.writeFile(path.join(directory, document.id + '.json'), JSON.stringify(document));
    assert.equal(await checkSceneDocuments(root, workspace.publicDirectory), 1);
    document.floor.asset = 'missing';
    await fs.writeFile(path.join(directory, document.id + '.json'), JSON.stringify(document));
    await assert.rejects(
      checkSceneDocuments(root, workspace.publicDirectory),
      /Unavailable scene asset/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await workspace.release();
  }
});
