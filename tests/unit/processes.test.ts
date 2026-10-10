import {
  writeBuildIdentity,
  verifyBuildIdentity,
  requireCurrentDesktopInputs,
} from '../../tools/build-identity';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { desktopEnvironment } from '../../tools/diagnostics/environment';

import { compareBenchmarks, type BenchmarkRecord } from '../../tools/diagnostics/benchmark-model';
import { compareGameBenchmarks, journeyPhases } from '../../tools/diagnostics/game-benchmark';

test('benchmark metadata crosses the serialized Electron boundary with explicit effective arguments', async () => {
  const app = {
    async evaluate(callback: Function, argument: unknown) {
      const evaluate = vm.runInNewContext(`(${callback.toString()})`, {
        process: { arch: 'arm64', versions: { node: '24', electron: '44', chrome: '144' } },
      });
      return JSON.parse(
        JSON.stringify(
          evaluate(
            {
              BrowserWindow: {
                getAllWindows: () => [{ getBounds: () => ({}), isVisible: () => false }],
              },
              screen: { getDisplayMatching: () => ({ displayFrequency: 60 }) },
            },
            argument,
          ),
        ),
      );
    },
  };
  const environment = await desktopEnvironment({
    app: app as unknown as Parameters<typeof desktopEnvironment>[0]['app'],
    flags: ['--hardware', 'fixture hardware'],
    launchArgs: ['--use-angle=metal', '--disable-gpu-sandbox', '--remote-debugging-port=0'],
  });
  assert.equal(environment.hardware, 'fixture hardware');
  assert.equal(environment.runtime.electron, '44');
  assert.equal(environment.refreshHz, 60);
  assert.equal(environment.visible, false);
  assert.deepEqual(environment.flags, ['--use-angle=metal', '--disable-gpu-sandbox']);
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

test('web identities need no Electron output and cannot be reused as desktop builds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-web-proof-'));
  const source = { commit: 'a'.repeat(40), dirty: true, sha256: 'a'.repeat(64) };
  try {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist/index.html'), 'web');
    const options = {
      root,
      source,
      assets: { identity: 'b'.repeat(64), recipe: 'c'.repeat(64) },
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
    await fs.mkdir(path.join(root, 'tools/diagnostics'), { recursive: true });
    const harness = path.join(root, 'tools/diagnostics/benchmark.ts');
    await fs.writeFile(harness, 'baseline harness');
    const built = { inputSha256: await sourceInputHash(root, { scope: 'desktop' }) };
    await requireCurrentDesktopInputs(built, root);
    await fs.writeFile(harness, 'changed harness');
    await requireCurrentDesktopInputs(built, root);
    await fs.writeFile(path.join(root, 'src/application.ts'), 'changed web');
    assert.notEqual(await sourceInputHash(root, { scope: 'web' }), web);
    await assert.rejects(requireCurrentDesktopInputs(built, root), /fresh desktop package/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
