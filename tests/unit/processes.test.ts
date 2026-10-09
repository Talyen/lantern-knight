import { writeBuildIdentity, verifyBuildIdentity } from '../../tools/build-identity';
import { sourceIdentity } from '../../tools/source-identity';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { executeRecipe, RecipeSchema, replayBundle } from '../../tools/diagnostics/session-replay';

import { compareBenchmarks, type BenchmarkRecord } from '../../tools/diagnostics/benchmark-model';
import { projectRoot } from '../../tools/assets/paths';
import { compareGameBenchmarks, journeyPhases } from '../../tools/diagnostics/game-benchmark';

test('replay CLI matches fresh-process evidence and rejects tampered hashes or changed source identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-replay-'));
  const cli = (args: string[]) =>
    execFileSync(
      process.execPath,
      ['--import', 'tsx', path.join(projectRoot, 'tools/diagnostics/session-replay.ts'), ...args],
      {
        cwd: projectRoot,
        env: { ...process.env, LANTERN_CACHE_ROOT: path.join(root, 'cache') },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      },
    );
  try {
    const recipe = path.join(root, 'recipe.json');
    await fs.copyFile(path.join(projectRoot, 'authoring/session-opening.json'), recipe);
    const output = cli(['record', recipe]),
      bundlePath = /Replay bundle: (.+)/.exec(output)![1]!,
      bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
    assert.match(cli(['replay', bundlePath]), /recorded actions matched/);
    const legacy = structuredClone(bundle);
    legacy.schemaVersion = 1;
    delete legacy.source.identityVersion;
    const legacyPath = path.join(root, 'legacy.json');
    await fs.writeFile(legacyPath, JSON.stringify(legacy));
    const source = await sourceIdentity(projectRoot);
    await assert.rejects(replayBundle(legacy, source), /source, asset pin or Node version differs/);
    assert.match(cli(['replay', legacyPath, '--experiment']), /REGRESSION EXPERIMENT/);

    bundle.result.hashes[0] = 'wrong';
    const bad = path.join(root, 'tampered.json');
    await fs.writeFile(bad, JSON.stringify(bundle));
    await assert.rejects(replayBundle(bundle, source), /recorded session diverged/);
    bundle.result.hashes[0] = JSON.parse(await fs.readFile(bundlePath, 'utf8')).result.hashes[0];
    bundle.source.sha256 = '0'.repeat(64);
    await fs.writeFile(bad, JSON.stringify(bundle));
    await assert.rejects(replayBundle(bundle, source), /source, asset pin or Node version differs/);
    assert.equal((await replayBundle(bundle, source, { experiment: true })).same, false);
    await fs.writeFile(recipe, JSON.stringify({ actions: [{ kind: 'load' }] }));
    let failed: { stderr: string } | undefined;
    try {
      cli(['record', recipe]);
      assert.fail('invalid Load recorded successfully');
    } catch (error) {
      failed = error as { stderr: string };
    }
    const diagnostics = /Replay failure diagnostics: (.+)/.exec(failed!.stderr)![1]!;
    assert.deepEqual(
      (await fs.readFile(path.join(diagnostics, 'actions.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      [{ index: 0, phase: 'attempted' }],
    );
    assert.ok(await fs.stat(path.join(diagnostics, 'recipe.json')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  await assert.rejects(
    executeRecipe({ actions: [{ kind: 'load' }] }),
    /previously saved checkpoint/,
  );
  assert.equal(
    RecipeSchema.safeParse({
      actions: [
        { kind: 'step', ticks: 36001, command: { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } } },
      ],
    }).success,
    false,
  );
});
test('performance comparisons normalize duration and refuse incompatible settings or malformed samples', () => {
  const record: BenchmarkRecord = {
    schemaVersion: 1,
    recordedAt: 'now',
    source: { commit: 'a', dirty: false, sha256: 'a', assetSha256: 'a' },
    build: { sourceCommit: 'a', dirty: false, sha256: 'a' },
    environment: {
      hardware: 'reference',
      os: 'mac',
      arch: 'arm64',
      runtime: { electron: '44' },
      flags: [],
      gpu: 'gpu',
      webgl: 'WebGL 2',
      refreshHz: 60,
      visible: true,
      viewport: [2560, 1440],
      buffer: [2560, 1440],
      dpr: 1,
      scenario: 'opening-loop-v1',
      warmupMs: 2000,
      assets: 'a'.repeat(64),
      settings: { quality: 1 },
    },
    requestedMs: 6000,
    frames: Array(60).fill(100),
    droppedMs: 0,
    simulatedTicks: 360,
  };
  const longer = {
    ...record,
    requestedMs: 12000,
    frames: [...record.frames, ...record.frames],
    source: { ...record.source, commit: 'b' },
    build: { ...record.build, sourceCommit: 'b' },
  };
  const comparison = compareBenchmarks(record, longer);
  assert.equal(comparison.delta.hitchesPer30s, 0);
  assert.equal(comparison.delta.stallsPer30s, 0);
  assert.equal(comparison.after.durationMs, 12000);
  for (const patch of [
    { visible: false },
    { gpu: 'other' },
    { refreshHz: 120 },
    { assets: 'b'.repeat(64) },
    { settings: { quality: 0.5 } },
    { runtime: { electron: '45' } },
    { warmupMs: 0 },
  ])
    assert.throws(
      () =>
        compareBenchmarks(record, { ...record, environment: { ...record.environment, ...patch } }),
      /Incompatible benchmark/,
    );
  assert.throws(
    () =>
      compareBenchmarks(record, {
        ...record,
        environment: { ...record.environment, refreshHz: 0 },
      }),
    /available refresh-rate/,
  );
  for (const frames of [[], [0], Array(60).fill(NaN)])
    assert.throws(() => compareBenchmarks(record, { ...record, frames }));
});
test('player comparisons reject incomplete or easier journeys and separate startup from phase cadence', () => {
  const record = {
    schemaVersion: 3,
    recordedAt: 'now',
    source: { commit: 'a', dirty: false, sha256: 'a' },
    build: { sourceCommit: 'a', dirty: false, sha256: 'a' },
    environment: {
      hardware: 'reference',
      os: 'mac',
      arch: 'arm64',
      runtime: { electron: '44' },
      flags: [],
      gpu: 'gpu',
      webgl: 'WebGL 2',
      refreshHz: 60,
      visible: true,
      viewport: [2560, 1440],
      buffer: [2560, 1440],
      dpr: 1,
      scenario: 'game-empty-v1',
      warmupMs: 0,
      assets: 'a'.repeat(64),
      settings: { quality: 1 },
    },
    initialCheckpoint: 'a'.repeat(64),
    startup: { launchToReadyMs: 1000, rendererReadyObservationMs: 900 },
    segments: journeyPhases.map((name) => ({
      name,
      frames: Array(60).fill(16),
      actions: ['pointerdown:canvas:0:100,100'],
    })),
    frames: Array(journeyPhases.length * 60).fill(16),
  };
  assert.equal(
    compareGameBenchmarks(record, {
      ...record,
      startup: { ...record.startup, launchToReadyMs: 800 },
    }).startupDeltaMs,
    -200,
  );
  assert.throws(() =>
    compareGameBenchmarks(record, { ...record, segments: record.segments.slice(1) }),
  );
  assert.throws(
    () =>
      compareGameBenchmarks(record, {
        ...record,
        segments: record.segments.map((s) => ({ ...s, actions: [] })),
      }),
    /Incompatible adaptive journey/,
  );
  assert.throws(
    () => compareGameBenchmarks(record, { ...record, initialCheckpoint: 'b'.repeat(64) }),
    /initial checkpoint/,
  );
  assert.throws(
    () =>
      compareGameBenchmarks(record, {
        ...record,
        environment: { ...record.environment, settings: { quality: 0.5 } },
      }),
    /Incompatible benchmark/,
  );
  assert.throws(() =>
    compareGameBenchmarks(record, {
      ...record,
      segments: record.segments.map((s) => ({ ...s, frames: [] })),
    }),
  );
});

test('build proof ignores mutable Finder metadata but rejects app tampering, mismatched commits and dirty CI reuse', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-build-proof-')),
    tool = path.resolve('tools/build-identity.ts'),
    env: NodeJS.ProcessEnv = {
      ...process.env,
      LANTERN_BUILD_SOURCE: JSON.stringify({ commit: null, dirty: true, sha256: '0'.repeat(64) }),
    };
  delete env.GITHUB_SHA;
  const run = (args: string[] = [], overrides: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), tool, ...args], {
      cwd: directory,
      env: { ...env, ...overrides },
      encoding: 'utf8',
    });
  try {
    await fs.mkdir(path.join(directory, 'dist'));
    await fs.mkdir(path.join(directory, 'dist-electron'));
    await fs.writeFile(path.join(directory, 'dist/app.js'), 'original');
    await fs.writeFile(path.join(directory, 'dist-electron/main.cjs'), 'main');
    await fs.writeFile(path.join(directory, 'dist/.DS_Store'), 'finder-one');
    const proof = (overrides: NodeJS.ProcessEnv = {}, write = false) =>
      (write ? writeBuildIdentity : verifyBuildIdentity)({
        root: directory,
        env: { ...env, ...overrides },
        report: () => {},
      });
    await assert.rejects(proof({ LANTERN_BUILD_SOURCE: undefined }, true), /guarded build/);
    assert.equal(run(['--write']).status, 0);
    const identityPath = path.join(directory, 'dist/build-identity.json'),
      identity = JSON.parse(await fs.readFile(identityPath, 'utf8'));
    assert.equal(identity.files['dist/.DS_Store'], undefined);
    await fs.writeFile(path.join(directory, 'dist/.DS_Store'), 'finder-two');
    await proof();
    await fs.writeFile(path.join(directory, 'dist/app.js'), 'tampered');
    await assert.rejects(proof(), /build artifact files differ/);
    await fs.writeFile(path.join(directory, 'dist/app.js'), 'original');
    identity.sourceCommit = 'a'.repeat(40);
    identity.dirty = false;
    await fs.writeFile(identityPath, JSON.stringify(identity));
    await assert.rejects(proof({ GITHUB_SHA: 'b'.repeat(40) }), /another commit/);
    identity.dirty = true;
    await fs.writeFile(identityPath, JSON.stringify(identity));
    await assert.rejects(proof({ GITHUB_SHA: identity.sourceCommit }), /clean source identity/);
    identity.dirty = false;
    await fs.writeFile(identityPath, JSON.stringify(identity));
    await proof({ GITHUB_SHA: identity.sourceCommit });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test('web identities need no Electron output and cannot be reused as desktop builds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-web-proof-'));
  const source = { commit: 'a'.repeat(40), dirty: true, sha256: 'a'.repeat(64) };
  try {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist/index.html'), 'web');
    const options = {
      root,
      source,
      target: 'web' as const,
      env: { ...process.env, GITHUB_SHA: undefined },
      report: () => {},
    };
    const web = await writeBuildIdentity(options);
    assert.equal(web.bundledDependencies, false);
    await verifyBuildIdentity(options);
    await fs.mkdir(path.join(root, 'dist-electron'));
    await fs.writeFile(path.join(root, 'dist-electron/main.cjs'), 'electron');
    await assert.rejects(
      verifyBuildIdentity({ ...options, target: 'desktop' }),
      /desktop artifact/,
    );
    await writeBuildIdentity({ ...options, target: 'desktop' });
    await verifyBuildIdentity({ ...options, target: 'desktop' });
    await fs.writeFile(path.join(root, 'dist-electron/main.cjs'), 'tampered');
    await assert.rejects(
      verifyBuildIdentity({ ...options, target: 'desktop' }),
      /artifact files differ/,
    );
    await assert.rejects(verifyBuildIdentity(options), /web artifact/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('smoke profiles never delete user-supplied directories, including on launch failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-profile-review-'));
  try {
    await fs.writeFile(path.join(directory, 'game.json'), 'existing player save');
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        path.resolve('tools/diagnostics/run-diagnostic.ts'),
        'game',
        '--profile',
        directory,
        '--output',
        path.join(directory, 'evidence'),
      ],
      {
        env: { ...process.env, LANTERN_EXECUTABLE: path.join(directory, 'missing-executable') },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.equal(
      await fs.readFile(path.join(directory, 'game.json'), 'utf8'),
      'existing player save',
    );
    assert.ok(!(await fs.readdir(directory)).some((name) => name.startsWith('lantern-smoke-')));
    assert.ok(await fs.stat(path.join(directory, 'evidence/failure.json')));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('web input identity ignores Electron-only edits while desktop identity observes them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-inputs-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    await fs.mkdir(path.join(root, 'src'));
    await fs.mkdir(path.join(root, 'electron'));
    await fs.writeFile(path.join(root, 'src/application.ts'), 'web');
    await fs.writeFile(path.join(root, 'electron/main.ts'), 'desktop');
    const { sourceInputHash } = await import('../../tools/source-identity');
    const web = await sourceInputHash(root, { scope: 'web' });
    const desktop = await sourceInputHash(root, { scope: 'desktop' });
    await fs.writeFile(path.join(root, 'electron/main.ts'), 'changed desktop');
    assert.equal(await sourceInputHash(root, { scope: 'web' }), web);
    assert.notEqual(await sourceInputHash(root, { scope: 'desktop' }), desktop);
    await fs.writeFile(path.join(root, 'src/application.ts'), 'changed web');
    assert.notEqual(await sourceInputHash(root, { scope: 'web' }), web);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
