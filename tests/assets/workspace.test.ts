import { writeJson } from '../../tools/json-file';
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
import { gameAssetCatalog } from '../../src/content/game-content';

test('runtime previews resolve selected Game artwork from the full pin', async () => {
  const reservation = net.createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const session = await openPreview({
    output: 'development',
    assets: 'pinned',
    scope: 'runtime',
    port,
  });
  try {
    assert.equal(session.workspace!.scope, 'runtime');
    const identity = await (await fetch(session.origin + '/__lantern_identity')).json();
    assert.equal(identity.scope, 'runtime');
    for (const [id, file] of Object.entries(gameAssetCatalog)) {
      const response = await fetch(session.origin + '/' + file);
      assert.equal(response.status, 200, id);
      assert.equal((await response.json()).asset.id, id);
    }
  } finally {
    await session.close();
  }
});

test('explicit pinned workspaces validate without ambient paths and reject occupied previews', async () => {
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
    // Full validation reads source pages and developer assets outside the runtime bundle.
    const authoring = await openWorkspace('pinned', 'authoring');
    try {
      await checkAssets(authoring);
    } finally {
      await authoring.release();
    }
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as net.AddressInfo).port;
    await assert.rejects(
      openPreview({ output: 'development', assets: 'pinned', scope: 'runtime', port }),
      /occupied/,
    );
    assert.equal(await workspace.ensurePublicFile!('generated/library/catalog.json'), true);
  } finally {
    if (prior === undefined) delete process.env.LANTERN_ASSET_WORKSPACE;
    else process.env.LANTERN_ASSET_WORKSPACE = prior;
    for (const socket of sockets) socket.destroy();
    if (reservation.listening)
      await new Promise<void>((resolve) => reservation.close(() => resolve()));
    await workspace.release();
  }
});

test('preview reuse verifies identity and closes only its own workspace', async () => {
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
    await assert.rejects(
      session.workspace!.ensurePublicFile!('generated/library/catalog.json'),
      /closed/,
    );
    assert.equal(await workspace.ensurePublicFile!('generated/library/catalog.json'), true);
    identity.assets = '0'.repeat(64);
    await assert.rejects(
      openPreview({ output: 'development', assets: 'pinned', scope: 'runtime', port, reuse: true }),
      /another checkout or asset identity/,
    );
    assert.equal(await workspace.ensurePublicFile!('generated/library/catalog.json'), true);
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
    // Game also includes startup bundles, so total bytes need not be a subset.
    assert.ok(game.files.length < runtime.files.length);
    await checkSceneDocuments(process.cwd(), workspace.publicDirectory, {
      allowUnpreparedDraftGround: true,
    });
    const directory = path.join(root, 'authoring/scenes');
    await fs.mkdir(directory, { recursive: true });
    const document = emptyScene();
    await writeJson(path.join(directory, document.id + '.json'), document);
    assert.equal(await checkSceneDocuments(root, workspace.publicDirectory), 1);
    document.floor.asset = 'missing';
    await writeJson(path.join(directory, document.id + '.json'), document);
    await assert.rejects(
      checkSceneDocuments(root, workspace.publicDirectory),
      /Unavailable scene asset/,
    );
    const draftGround = { allowUnpreparedDraftGround: true };
    await assert.rejects(
      checkSceneDocuments(root, workspace.publicDirectory, draftGround),
      /Unavailable scene asset/,
    );
    document.floor.layout = 'artwork';
    document.floor.clip = 'still';
    await writeJson(path.join(directory, document.id + '.json'), document);
    assert.equal(await checkSceneDocuments(root, workspace.publicDirectory, draftGround), 1);
    document.proceduralAssets = ['missing-prop'];
    await writeJson(path.join(directory, document.id + '.json'), document);
    await assert.rejects(
      checkSceneDocuments(root, workspace.publicDirectory, draftGround),
      /Unavailable scene asset: missing-prop/,
    );
    document.proceduralAssets = [];
    document.target = 'live';
    await writeJson(path.join(directory, document.id + '.json'), document);
    await assert.rejects(
      checkSceneDocuments(root, workspace.publicDirectory, draftGround),
      /Unavailable scene asset/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await workspace.release();
  }
});
