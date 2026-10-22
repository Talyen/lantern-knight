import { temporaryDirectory } from '../fixtures/temporary-directory';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { selectTestFiles, ciDefaultSuites } from '../../tools/test';
import { coverageFor, documentationOnly } from '../../tools/coverage-policy';
const requiresDesktop = (files: readonly string[]) => coverageFor(files).desktop;
const requiresAuthoring = (files: readonly string[]) => coverageFor(files).authoring;
import { browserSelection, ciDevelopmentFiles } from '../../tools/browser-tests';
import { changedFiles, comparisonFiles } from '../../tools/changed-files';
import { verificationSteps } from '../../tools/verify-target';
import { browserShards } from '../../tools/ci-browser-shard';
import { checkAssets } from '../../tools/check-assets';
import { parseAssetArgs } from '../../tools/assets/cli';

test('preparation options reject discarded selections before acquiring sources or the GPU lane', () => {
  assert.throws(() => parseAssetArgs(['prepare', '--ids', 'hero', '--proof']), /not both/);
  assert.throws(() => parseAssetArgs(['prepare', '--local']), /not preparation/);
  assert.throws(() => parseAssetArgs(['prepare', '--ids']), /asset-id/);
  assert.throws(() => parseAssetArgs(['prepare', 'hero']), /asset-id/);
  for (const args of [[], ['--proof'], ['--gpu'], ['--ids', 'hero', 'tree']]) {
    const parsed = parseAssetArgs(['prepare', ...args]);
    assert.equal(parsed.command, 'prepare');
    assert.deepEqual(parsed.positionals, args.includes('--ids') ? ['hero', 'tree'] : []);
  }
  assert.equal(parseAssetArgs(['inspect', '--local', 'hero']).values.local, true);
  assert.equal(parseAssetArgs(['check', '--local']).values.local, true);
});
test('concise test output preserves failures, skips, TODOs and process diagnostics', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-reporter-');
  const file = path.join(root, 'reporter.test.mjs');

  await fs.writeFile(
    file,
    `import test from 'node:test';
import assert from 'node:assert/strict';
console.log('stdout-marker');
console.error('stderr-marker');
test('passing suite', async t => { await t.test('passing leaf', () => {}); });
test('skipped leaf', { skip: 'fixture skip' }, () => {});
test('todo leaf', { todo: 'fixture todo' }, () => {});
if (process.env.LANTERN_REPORTER_FAILURE === '1')
  test('broken suite', async t => {
    await t.test('broken leaf', () => assert.equal(1, 2, 'failure-marker'));
  });
`,
  );
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const failure of [false, true]) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        '--test',
        '--test-reporter=./tools/test-reporter.ts',
        file,
      ],
      {
        encoding: 'utf8',
        env: { ...env, LANTERN_REPORTER_FAILURE: failure ? '1' : '0' },
        timeout: 10000,
      },
    );
    const output = result.stdout + result.stderr;
    assert.equal(result.status, failure ? 1 : 0, output);
    assert.doesNotMatch(output, /passing (suite|leaf)/);
    for (const marker of ['stdout-marker', 'stderr-marker', 'fixture skip', 'fixture todo'])
      assert.ok(output.includes(marker), output);
    assert.match(output, /ℹ skipped 1/);
    assert.match(output, /ℹ todo 1/);
    if (failure) {
      assert.match(output, /broken leaf/);
      assert.match(output, /failure-marker/);
      assert.match(output, /reporter\.test\.mjs:\d+/);
      assert.match(output, /ℹ fail [1-9]/);
    } else assert.match(output, /ℹ fail 0/);
  }
});
test('fast defaults, full coverage and explicit paths cannot silently lose CI suites', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-selection-');

  await fs.mkdir(path.join(root, 'tests/unit'), { recursive: true });
  const fast = 'tests/unit/one.test.ts',
    integrations = Object.keys(ciDefaultSuites);
  const integration = integrations[0]!;
  for (const file of [fast, ...integrations])
    await fs.writeFile(path.join(root, file), 'export {};');
  assert.deepEqual(await selectTestFiles([], root), [fast]);
  assert.deepEqual(await selectTestFiles(['--full'], root), [fast, ...integrations].sort());
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
  assert.deepEqual(await selectTestFiles(['--full'], root), integrations.sort());
  await fs.writeFile(path.join(root, fast), 'export {};');
  for (const file of integrations) {
    await fs.rm(path.join(root, file));
    for (const args of [[], ['--full'], [fast]])
      await assert.rejects(selectTestFiles(args, root), /Missing CI-default test suite/);
    await fs.writeFile(path.join(root, file), 'export {};');
  }
  // Also check actual discovery: a new suite runs locally unless deliberately classified.
  const all = await selectTestFiles(['--full']),
    local = await selectTestFiles([]);
  assert.deepEqual(
    local,
    all.filter((file) => !(file in ciDefaultSuites)),
  );
  for (const file of Object.keys(ciDefaultSuites)) assert.ok(all.includes(file));
});
test('scene and gameplay edits use routine CI; desktop contracts select platform verification', () => {
  assert.equal(requiresAuthoring(['src/editor/model.ts']), true);
  assert.equal(requiresAuthoring(['tests/browser/fixtures.ts']), true);
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
    'src/platform/bridge.ts',
    'src/platform/settings.ts',
    'src/platform/storage-codec.ts',
    'assets/lock.json',
    'tools/package.ts',
    'tools/stage-desktop-web.ts',
    'tests/fixtures/input.ts',
    'package-lock.json',
  ])
    assert.equal(requiresDesktop([file]), true);
});
test('built browser tests select only Game and remove the wrapper flag', () => {
  assert.deepEqual(browserSelection(['game', '--built', '--ui']), {
    built: true,
    forwarded: ['tests/browser/game', '--ui'],
    scope: 'runtime',
  });
  for (const selector of ['game-loot', 'game-loot.spec.ts', 'tests/browser/game.spec.ts']) {
    assert.equal(browserSelection([selector]).scope, 'runtime');
    assert.deepEqual(browserSelection([selector, '--built']), {
      built: true,
      forwarded: [selector.startsWith('tests/browser/') ? selector : 'tests/browser/' + selector],
      scope: 'runtime',
    });
  }
  assert.throws(() => browserSelection(['game', 'editor', '--built']), /Game scenario/);
  assert.throws(() => browserSelection(['scene', '--built']), /Game scenario/);
  assert.throws(() => browserSelection(['--built']), /Game scenario/);
  assert.equal(browserSelection(['editor']).scope, 'authoring');
  assert.equal(browserSelection(['scene']).scope, 'authoring');
  assert.deepEqual(browserSelection(['game', '--grep', 'game']).forwarded, [
    'tests/browser/game',
    '--grep',
    'game',
  ]);
  for (const options of [
    ['--grep', 'inventory'],
    ['--project', 'chromium'],
    ['--grep-invert', 'slow journey'],
  ])
    assert.deepEqual(browserSelection(['game', '--built', ...options]), {
      built: true,
      forwarded: ['tests/browser/game', ...options],
      scope: 'runtime',
    });
  const filter = new RegExp(browserSelection(['game']).forwarded[0]!);
  assert.ok(filter.test('/tmp/game-worktree/tests/browser/game-loot.spec.ts'));
  assert.ok(!filter.test('/tmp/game-worktree/tests/browser/audio.spec.ts'));
  assert.ok(!filter.test('/tmp/game-worktree/tests/browser/editor-gameplay.spec.ts'));
});
test('authoring storage and selection tools select their browser CI tier', () => {
  for (const file of [
    'tools/scene/scene-editor-store.ts',
    'tools/scene/fragment-store.ts',
    'tools/scene/ground-profile-store.ts',
    'tools/segmentation/service.ts',
  ])
    assert.equal(requiresAuthoring([file]), true, file);
  for (const file of [
    'tools/cli.ts',
    'tools/scope-exit.ts',
    'tools/json-file.ts',
    'tools/verified-files.ts',
    'tools/run-process.ts',
    'tools/command-lane.ts',
    'tools/assets/download.ts',
    'tools/assets/file-delivery.ts',
    'tools/assets/cache.ts',
  ])
    assert.deepEqual(
      coverageFor([file]),
      { source: true, desktop: true, authoring: true, assets: true },
      file,
    );
});
test('asset validation reads the explicit workspace and rejects altered media', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-explicit-assets-');

  const { loadingVideoPath } = await import('../../src/content/loading-media');
  await fs.mkdir(path.dirname(path.join(root, loadingVideoPath)), { recursive: true });
  await fs.writeFile(path.join(root, loadingVideoPath), 'altered media');
  await assert.rejects(checkAssets({ publicDirectory: root }), /loading video differs/);
});

test('preview and policy changes select both optional tiers; missing comparisons fail closed', () => {
  assert.deepEqual(coverageFor(), { source: true, desktop: true, authoring: true, assets: true });
  for (const file of [
    'tools/preview-session.ts',
    'tools/coverage-policy.ts',
    'playwright.config.ts',
  ])
    assert.deepEqual(coverageFor([file]), {
      source: true,
      desktop: true,
      authoring: true,
      assets: file === 'tools/preview-session.ts',
    });
  assert.deepEqual(coverageFor(['docs/development.md']), {
    source: false,
    desktop: false,
    authoring: false,
    assets: false,
  });
});

test('full asset coverage follows asset consumers, not unrelated editor or gameplay edits', () => {
  for (const file of [
    'assets/lock.json',
    'authoring/hero-actions.json',
    'src/presentation/sprite.ts',
    'src/assets/schema.ts',
    'src/content/hero-actions.ts',
    'src/core/animation-treatment.ts',
    'tools/assets/file-delivery.ts',
    'tests/assets/workspace.test.ts',
    'package-lock.json',
  ])
    assert.equal(coverageFor([file]).assets, true, file);
  for (const file of [
    'src/editor/model.ts',
    'src/core/simulation.ts',
    'docs/development.md',
    '.github/workflows/ci.yml',
    'tools/coverage-policy.ts',
    'playwright.config.ts',
    'tools/browser-tests.ts',
  ])
    assert.equal(coverageFor([file]).assets, false, file);
});

test('CI accounts for every browser suite and runs development lifetime regressions', async () => {
  const files = (await fs.readdir('tests/browser')).filter((file) => file.endsWith('.spec.ts'));
  const routine = ciDevelopmentFiles(files, false);
  const authoring = ciDevelopmentFiles(files, true);
  assert.ok(routine.includes('scene-lifetime.spec.ts'));
  assert.ok(authoring.includes('editor-adventure.spec.ts'));
  assert.ok(!routine.includes('editor-adventure.spec.ts'));
  assert.ok(!authoring.includes('editor-exploration.spec.ts'));
  assert.ok(files.includes('game-loot.spec.ts'));
  assert.ok(!authoring.some((file) => file.startsWith('game') || file.startsWith('orchard')));
  assert.deepEqual(
    ciDevelopmentFiles(['game-loot.spec.ts', 'editor-regressions.spec.ts', 'scene.spec.ts'], false),
    ['scene.spec.ts'],
  );
  assert.throws(() => ciDevelopmentFiles([...files, 'unclassified.spec.ts'], false), /no CI tier/);
  assert.throws(() => ciDevelopmentFiles([...files, 'unclassified.spec.ts'], true), /no CI tier/);
});

test('cost shards retain every parameterized and nested case once and separate expensive cases', () => {
  const suite = (file: string, titles: string[]) => ({
    title: file,
    file,
    line: 0,
    specs: titles.map((title) => ({ file, title })),
  });
  const input = [
    suite('editor-game-view.spec.ts', ['outside', 'inside']),
    suite('scene-lifetime.spec.ts', ['failure', 'shutdown', 'retired controls', 'remount']),
    {
      ...suite('scene-cohesion.spec.ts', []),
      suites: [{ ...suite('scene-cohesion.spec.ts', ['reload']), title: 'persistence', line: 30 }],
    },
  ];
  const plan = browserShards(input, 2);
  const names = plan.flatMap((shard) => shard.tests);
  assert.equal(names.length, 7);
  assert.equal(new Set(names).size, 7);
  assert.ok(names.includes('scene-cohesion.spec.ts › persistence › reload'));
  for (const shard of plan)
    assert.equal(shard.tests.filter((name) => name.startsWith('editor-game-view')).length, 1);
  assert.deepEqual(browserShards(input.slice().reverse(), 2), plan);
  assert.throws(() => browserShards(input, 0), /Invalid/);
  assert.throws(() => browserShards([], 2), /unique runnable/);
  assert.throws(() => browserShards([input[0]!, input[0]!], 2), /unique runnable/);
});

test('native Playwright test-list discovery retains every planned browser case', async (t) => {
  const directory = await temporaryDirectory(t, 'lantern-ci-discovery-');
  const files = ciDevelopmentFiles(
    (await fs.readdir('tests/browser')).filter((file) => file.endsWith('.spec.ts')),
    true,
  );
  const env = { ...process.env };
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
  delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  const discover = (filters: string[]) => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'node_modules/@playwright/test/cli.js',
        'test',
        ...filters,
        '--list',
        '--reporter=json',
      ],
      { env, encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const original = discover(files.map((file) => 'tests/browser/' + file));
  const plan = browserShards(original.suites, 16);
  const file = path.join(directory, 'tests.txt');
  await fs.writeFile(file, plan.flatMap((shard) => shard.tests).join('\n'));
  const selected = discover(['--test-list', file]);
  const ids = (suites: typeof original.suites): string[] =>
    suites
      .flatMap((suite: { specs: { id: string }[]; suites?: typeof suites }) => [
        ...suite.specs.map((spec) => spec.id),
        ...ids(suite.suites ?? []),
      ])
      .sort();
  assert.deepEqual(ids(selected.suites), ids(original.suites));
  assert.equal(ids(selected.suites).length, plan.flatMap((shard) => shard.tests).length);
});

test('repeated global mocks restore original descriptors and remove newly introduced globals', async (t) => {
  const { mockGlobals } = await import('../fixtures/globals');
  const before = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const absent = '__lantern_mock_fixture__';
  assert.equal(Object.hasOwn(globalThis, absent), false);
  await t.test('mocked lifetime', (scope) => {
    mockGlobals(scope, { fetch: 'first', [absent]: 1 });
    mockGlobals(scope, { fetch: 'second', [absent]: 2 });
    assert.equal(Reflect.set(globalThis, absent, 3), true);
    assert.equal(Reflect.get(globalThis, absent), 3);
  });
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'fetch'), before);
  assert.equal(Object.hasOwn(globalThis, absent), false);
});

test('only known prose changes omit source and runtime verification', () => {
  for (const files of [
    ['README.md', 'docs/assets.md', '.agents/skills/architect/SKILL.md'],
    ['references/visual/README.md'],
  ]) {
    assert.equal(documentationOnly(files), true);
    assert.deepEqual(coverageFor(files), {
      source: false,
      desktop: false,
      authoring: false,
      assets: false,
    });
  }
  for (const files of [
    undefined,
    [],
    ['docs/development.md', 'src/main.ts'],
    ['unknown.md/file'],
    ['references/canon/hero.md'],
    ['docs/schema.json'],
    ['tools/new-tool.ts'],
  ]) {
    assert.equal(documentationOnly(files), false);
    assert.equal(coverageFor(files).source, true);
  }
});

test('change selection includes deletions, both sides of moves, staged and untracked inputs', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-changes-');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  await fs.writeFile(path.join(root, 'old.ts'), 'export {};');
  await fs.writeFile(path.join(root, 'README.md'), 'before');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('mv', 'old.ts', 'moved.ts');
  await fs.writeFile(path.join(root, 'README.md'), 'after');
  await fs.writeFile(path.join(root, 'new.ts'), 'export {};');
  const selected = ['README.md', 'moved.ts', 'new.ts', 'old.ts'];
  assert.deepEqual(changedFiles(root, base), selected);
  assert.deepEqual(comparisonFiles(root), selected);
  assert.equal(documentationOnly(changedFiles(root, base)), false);
  assert.throws(() => changedFiles(root, 'missing-base'));
  assert.equal(comparisonFiles(root, 'missing-base'), undefined);
});

test('verification targets select setup and tests in order; listing never builds', () => {
  assert.deepEqual(verificationSteps(['game']), [
    ['build.ts'],
    ['browser-tests.ts', 'game', '--built'],
  ]);
  assert.deepEqual(verificationSteps(['game', '--local']), [
    ['build.ts', '--local'],
    ['browser-tests.ts', 'game', '--built'],
  ]);
  assert.deepEqual(verificationSteps(['authoring']), [
    ['browser-tests.ts', '--ci-development', '--authoring'],
  ]);
  assert.deepEqual(verificationSteps(['desktop', '--local', '--platform', 'win'], 'win32'), [
    ['package.ts', '--unsigned', '--local', '--platform', 'win'],
    ['desktop-tests.ts'],
  ]);
  for (const target of ['game', 'authoring', 'desktop']) {
    const steps = verificationSteps([target, '--list']);
    assert.equal(steps.length, 1);
    assert.equal(steps[0]!.at(-1), '--list');
    assert.ok(steps[0]![0]!.endsWith('tests.ts'));
  }
  assert.throws(() => verificationSteps(['unknown']));
  assert.throws(() => verificationSteps(['game', '--platform', 'mac']));
  assert.throws(() => verificationSteps(['desktop', '--platform', 'unknown']));
  assert.deepEqual(verificationSteps(['authoring', '--local']), verificationSteps(['authoring']));
  assert.throws(
    () => verificationSteps(['desktop', '--platform', 'win'], 'darwin'),
    /selected macOS or Windows host/,
  );
  assert.throws(() => verificationSteps(['desktop'], 'linux'), /selected macOS or Windows host/);
});

test('CI emits prose-only and source job decisions from real Git changes, falling back on unavailable bases', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-ci-impact-');
  const reports = await temporaryDirectory(t, 'lantern-ci-output-');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  await fs.writeFile(path.join(root, 'README.md'), 'before');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(root, 'README.md'), 'after');
  const output = path.join(reports, 'output');
  const select = async (comparison: string) => {
    await fs.writeFile(output, '');
    const result = spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), path.resolve('tools/ci-impact.ts')],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, LANTERN_CI_BASE: comparison, GITHUB_OUTPUT: output },
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return fs.readFile(output, 'utf8');
  };
  assert.equal(await select(base), 'source=false\ndesktop=false\nauthoring=false\nassets=false\n');
  await fs.writeFile(path.join(root, 'new.ts'), 'export {};');
  assert.match(await select(base), /^source=true/);
  assert.equal(
    await select('missing-base'),
    'source=true\ndesktop=true\nauthoring=true\nassets=true\n',
  );
});
