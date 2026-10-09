import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { selectTestFiles } from '../../tools/test';
import { requiresDesktop, requiresAuthoring } from '../../tools/ci-impact';
test('explicit test paths are exact and unknown requests fail before asset setup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-selection-'));
  try {
    await fs.mkdir(path.join(root, 'tests/unit'), { recursive: true });
    await fs.writeFile(path.join(root, 'tests/unit/one.test.ts'), 'export {};');
    assert.deepEqual(
      await selectTestFiles(['tests/unit/one.test.ts', './tests/unit/one.test.ts'], root),
      ['tests/unit/one.test.ts'],
    );
    await assert.rejects(selectTestFiles(['tests/unit'], root), /Invalid test selection/);
    await assert.rejects(selectTestFiles(['--unknown'], root), /Invalid test selection/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('scene and gameplay edits use routine CI; desktop contracts select platform verification', () => {
  assert.equal(requiresAuthoring(['src/editor/model.ts']), true);
  assert.equal(requiresAuthoring(['src/core/simulation.ts']), false);
  assert.equal(
    requiresDesktop([
      'authoring/scenes/live-court.json',
      'src/core/simulation.ts',
      'docs/development.md',
    ]),
    false,
  );
  for (const file of [
    'electron/store.ts',
    'src/core/save.ts',
    'assets/lock.json',
    'tools/package.ts',
    'package-lock.json',
  ])
    assert.equal(requiresDesktop([file]), true);
});
