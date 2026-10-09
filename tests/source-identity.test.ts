import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sourceIdentity } from '../tools/source-identity';
import { verificationIdentity } from '../tools/verification';

test('runtime identity follows imported live documents without including unrelated guidance or recipes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-identity-'));
  try {
    for (const dir of ['src', 'authoring/scenes', 'assets', 'docs', 'tools/assets'])
      await fs.mkdir(path.join(root, dir), { recursive: true });
    await fs.writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          types: [],
        },
        include: ['src'],
      }),
    );
    await fs.writeFile(
      path.join(root, 'src/world.ts'),
      "import scene from '../authoring/scenes/live-court.json'; export default scene; // import ignored from '../authoring/unrelated.json';",
    );
    await fs.writeFile(
      path.join(root, 'assets/lock.json'),
      JSON.stringify({
        schemaVersion: 1,
        releaseTag: 'assets-' + 'a'.repeat(16),
        filename: 'lantern-assets.tar.gz',
        sha256: 'a'.repeat(64),
        inventorySha256: 'b'.repeat(64),
        bytes: 10,
        recipeSha256: 'c'.repeat(64),
      }),
    );
    await fs.writeFile(path.join(root, 'authoring/scenes/live-court.json'), '{}');
    await fs.writeFile(path.join(root, 'authoring/unrelated.json'), '{}');
    await fs.writeFile(path.join(root, 'docs/guide.md'), 'Guide');
    await fs.writeFile(
      path.join(root, 'tools/assets/authoring-catalog.ts'),
      'export const catalog = 1;',
    );
    const before = await sourceIdentity(root),
      verification = await verificationIdentity(root);
    await fs.writeFile(path.join(root, 'docs/guide.md'), 'Changed guide');
    await fs.writeFile(path.join(root, 'authoring/unrelated.json'), '[1]');
    assert.equal((await sourceIdentity(root)).sha256, before.sha256);
    assert.notEqual((await verificationIdentity(root)).sha256, verification.sha256);
    await fs.writeFile(
      path.join(root, 'tools/assets/authoring-catalog.ts'),
      'export const catalog = 2;',
    );
    assert.notEqual(
      (await sourceIdentity(root)).sha256,
      before.sha256,
      'Build helper edits invalidate reuse',
    );
    const afterHelper = await sourceIdentity(root);
    await fs.writeFile(path.join(root, 'tools/delivery.ts'), 'export const build = 1;');
    const afterExecutor = await sourceIdentity(root);
    assert.notEqual(
      afterExecutor.sha256,
      afterHelper.sha256,
      'Delivery executor invalidates build reuse',
    );
    await fs.writeFile(path.join(root, 'authoring/scenes/live-court.json'), '{"x":2}');
    assert.notEqual((await sourceIdentity(root)).sha256, afterExecutor.sha256);
    if (process.platform !== 'win32') {
      await fs.rm(path.join(root, 'authoring/scenes/live-court.json'));
      await fs.symlink(
        path.join(root, 'authoring/unrelated.json'),
        path.join(root, 'authoring/scenes/live-court.json'),
      );
      await assert.rejects(sourceIdentity(root), /cannot follow symlink/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
