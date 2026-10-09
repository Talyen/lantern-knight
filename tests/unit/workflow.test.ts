import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { selectTestFiles } from '../../tools/test';
import { coverageFor } from '../../tools/coverage-policy';
const requiresDesktop = (files: readonly string[]) => coverageFor(files).desktop;
const requiresAuthoring = (files: readonly string[]) => coverageFor(files).authoring;
import { browserSelection } from '../../tools/browser-tests';
import { checkAssets } from '../../tools/check-assets';
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
      'authoring/scenes/example.json',
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
test('built browser tests select only Game and remove the wrapper flag', () => {
  assert.deepEqual(browserSelection(['game', '--built', '--ui']), {
    built: true,
    forwarded: ['game', '--ui'],
    scope: 'runtime',
  });
  assert.throws(() => browserSelection(['scene', '--built']), /Game scenario/);
  assert.throws(() => browserSelection(['--built']), /Game scenario/);
  assert.equal(browserSelection(['editor']).scope, 'authoring');
});
test('asset validation reads the explicit workspace and rejects altered media', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-explicit-assets-'));
  try {
    const { loadingVideoPath } = await import('../../src/content/loading-media');
    await fs.mkdir(path.dirname(path.join(root, loadingVideoPath)), { recursive: true });
    await fs.writeFile(path.join(root, loadingVideoPath), 'altered media');
    await assert.rejects(checkAssets({ publicDirectory: root }), /loading video differs/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('preview and policy changes select both optional tiers; missing comparisons fail closed', () => {
  assert.deepEqual(coverageFor(), { desktop: true, authoring: true });
  for (const file of [
    'tools/preview-session.ts',
    'tools/coverage-policy.ts',
    'playwright.config.ts',
  ])
    assert.deepEqual(coverageFor([file]), { desktop: true, authoring: true });
  assert.deepEqual(coverageFor(['docs/development.md']), { desktop: false, authoring: false });
});
