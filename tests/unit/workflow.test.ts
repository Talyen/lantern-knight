import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { selectTestFiles, ciDefaultSuites } from '../../tools/test';
import { coverageFor } from '../../tools/coverage-policy';
const requiresDesktop = (files: readonly string[]) => coverageFor(files).desktop;
const requiresAuthoring = (files: readonly string[]) => coverageFor(files).authoring;
import { browserSelection } from '../../tools/browser-tests';
import { checkAssets } from '../../tools/check-assets';
test('fast defaults, full coverage and explicit paths cannot silently lose CI suites', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-selection-'));
  try {
    await fs.mkdir(path.join(root, 'tests/unit'), { recursive: true });
    const fast = 'tests/unit/one.test.ts',
      integration = 'tests/unit/process-integration.test.ts';
    for (const file of [fast, integration]) await fs.writeFile(path.join(root, file), 'export {};');
    assert.deepEqual(await selectTestFiles([], root), [fast]);
    assert.deepEqual(await selectTestFiles(['--full'], root), [fast, integration]);
    assert.deepEqual(await selectTestFiles([integration, './' + integration], root), [integration]);
    await assert.rejects(selectTestFiles(['tests/unit'], root), /Invalid test selection/);
    await assert.rejects(selectTestFiles(['--unknown'], root), /Invalid test selection/);
    await assert.rejects(selectTestFiles(['--full', fast], root), /Use --full/);
    await fs.mkdir(path.join(root, 'tests/assets'));
    await fs.writeFile(path.join(root, 'tests/assets/one.test.ts'), 'export {};');
    assert.deepEqual(await selectTestFiles([], root, 'assets'), ['tests/assets/one.test.ts']);
    await assert.rejects(selectTestFiles(['--full'], root, 'assets'), /Use --full/);
    await fs.rm(path.join(root, fast));
    await assert.rejects(selectTestFiles([], root), /No local test suites/);
    assert.deepEqual(await selectTestFiles(['--full'], root), [integration]);
    await fs.writeFile(path.join(root, fast), 'export {};');
    await fs.rm(path.join(root, integration));
    for (const args of [[], ['--full'], [fast]])
      await assert.rejects(selectTestFiles(args, root), /Missing CI-default test suite/);
    // Also check actual discovery: a new suite runs locally unless deliberately classified.
    const all = await selectTestFiles(['--full']),
      local = await selectTestFiles([]);
    assert.deepEqual(
      local,
      all.filter((file) => !(file in ciDefaultSuites)),
    );
    for (const file of Object.keys(ciDefaultSuites)) assert.ok(all.includes(file));
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
  assert.equal(browserSelection(['scene']).scope, 'authoring');
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
