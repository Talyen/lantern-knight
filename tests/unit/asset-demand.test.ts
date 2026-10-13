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
    await fs.writeFile(
      path.join(publicRoot, relative),
      JSON.stringify(relative === file ? manifest : { 'library-tree': file }),
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
