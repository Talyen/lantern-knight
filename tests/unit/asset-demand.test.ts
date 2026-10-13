import { writeJson } from '../../tools/json-file';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('matching development server reuse acquires no asset workspace', async () => {
  const { createServer } = await import('node:http');
  const { projectRoot } = await import('../../tools/assets/paths');
  const { readLock } = await import('../../tools/assets/pack');
  const { openPreview } = await import('../../tools/preview-session');
  const identity = {
    root: await fs.realpath(projectRoot),
    assets: (await readLock()).sha256,
    target: 'development',
    scope: 'authoring',
  };
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(identity));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server');
    const options = {
      output: 'development' as const,
      assets: 'pinned' as const,
      scope: 'authoring' as const,
      port: address.port,
      reuse: true,
      demand: true,
    };
    const session = await openPreview(options);
    assert.equal(session.ownsServer, false);
    assert.equal(session.workspace, undefined);
    assert.equal(session.assetIdentity, identity.assets);
    await session.close();
    identity.assets = '0'.repeat(64);
    await assert.rejects(openPreview(options), /another checkout or asset identity/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('ground selection acquires its original source image before invoking segmentation', async (t) => {
  const { SegmentationService } = await import('../../tools/segmentation/service');
  const { manifestFixture } = await import('../fixtures/manifest');
  const root = await temporaryDirectory(t, 'lantern-demand-selection-');
  const publicRoot = path.join(root, 'public');
  const manifest = manifestFixture('library-tree');
  const file = 'generated/library/library-tree/manifest.json';
  const source = path.posix.join(path.posix.dirname(file), manifest.pages[0]!.path);
  const calls: string[] = [];
  const service = new SegmentationService(root, publicRoot, async (relative) => {
    calls.push(relative);
    if (relative === source) throw new Error('Source requested before model execution');
    await fs.mkdir(path.dirname(path.join(publicRoot, relative)), { recursive: true });
    await writeJson(
      path.join(publicRoot, relative),
      relative === file ? manifest : { 'library-tree': file },
    );
    return true;
  });
  try {
    await assert.rejects(
      service.select(
        {
          asset: 'library-tree',
          frame: manifest.frames[0]!.id,
          hash: manifest.pages[0]!.hash,
          crop: [0, 0, 1, 1],
          box: [0, 0, 1, 1],
        },
        new AbortController().signal,
      ),
      /Source requested before model execution/,
    );
    assert.deepEqual(calls, ['generated/library/catalog.json', file, source]);
  } finally {
    service.dispose();
  }
});

test('on-demand previews acquire and serve newly published audio samples', async (t) => {
  const { createServer } = await import('vite');
  const { demandArtworkPlugin } = await import('../../tools/assets/demand-plugin');
  const root = await temporaryDirectory(t, 'lantern-demand-audio-');
  const requested: string[] = [];
  const server = await createServer({
    configFile: false,
    root,
    publicDir: root,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [
      demandArtworkPlugin(root, async (file) => {
        requested.push(file);
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), 'prepared sample');
        return true;
      }),
    ],
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server');
    for (const extension of ['wav', 'ogg']) {
      const file = `audio/${'a'.repeat(64)}.${extension}`;
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/${file}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'prepared sample');
      assert.equal(
        response.headers.get('content-type'),
        extension === 'wav' ? 'audio/wav' : 'audio/ogg',
      );
    }
    assert.equal(requested.length, 2);
  } finally {
    await server.close();
  }
});

test('Game previews resolve on-demand artwork before Vite can return its HTML fallback', async (t) => {
  const { createServer } = await import('vite');
  const { webConfig } = await import('../../vite.config');
  const root = await temporaryDirectory(t, 'lantern-game-demand-');
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Game</title>');
  const file = 'generated/library/library-game-art/manifest.json';
  const requested: string[] = [];
  const server = await createServer({
    ...webConfig(root, 'game', async (relative) => {
      requested.push(relative);
      await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeJson(path.join(root, relative), { asset: { id: 'library-game-art' } });
      return true;
    }),
    configFile: false,
    root,
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server');
    const response: Response = await fetch(`http://127.0.0.1:${address.port}/${file}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { asset: { id: 'library-game-art' } });
    assert.deepEqual(requested, [file]);
  } finally {
    await server.close();
  }
});
