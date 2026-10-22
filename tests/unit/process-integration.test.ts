import { onAsyncExit } from '../../tools/scope-exit';
import { temporaryDirectory } from '../fixtures/temporary-directory';
import { readJson, writeJson } from '../../tools/json-file';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeBuildIdentity, verifyBuildIdentity } from '../../tools/build-identity';
import { sourceIdentity } from '../../tools/source-identity';
import { executeRecipe, RecipeSchema, replayBundle } from '../../tools/diagnostics/session-replay';
import { projectRoot } from '../../tools/assets/paths';
import { GameSession } from '../../src/core/session';
import type { Command } from '../../src/core/command';
import { content } from '../../src/content/game-content';

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
      bundle = await readJson(bundlePath);
    assert.match(cli(['replay', bundlePath]), /recorded actions matched/);
    const legacy = structuredClone(bundle);
    legacy.schemaVersion = 1;
    delete legacy.source.identityVersion;
    const legacyPath = path.join(root, 'legacy.json');
    await writeJson(legacyPath, legacy);
    const source = await sourceIdentity(projectRoot);
    await assert.rejects(replayBundle(legacy, source), /source, asset pin or Node version differs/);
    assert.match(cli(['replay', legacyPath, '--experiment']), /REGRESSION EXPERIMENT/);

    bundle.result.hashes[0] = 'wrong';
    const bad = path.join(root, 'tampered.json');
    await writeJson(bad, bundle);
    await assert.rejects(replayBundle(bundle, source), /recorded session diverged/);
    bundle.result.hashes[0] = (await readJson(bundlePath)).result.hashes[0];
    bundle.source.sha256 = '0'.repeat(64);
    await writeJson(bad, bundle);
    await assert.rejects(replayBundle(bundle, source), /source, asset pin or Node version differs/);
    assert.equal((await replayBundle(bundle, source, { experiment: true })).same, false);
    await writeJson(recipe, { actions: [{ kind: 'load' }] });
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
test('build proof ignores mutable Finder metadata but rejects app tampering, mismatched commits and dirty CI reuse', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-build-proof-')),
    tool = path.resolve('tools/build-identity.ts'),
    env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GITHUB_SHA;
  const run = (args: string[] = []) =>
    spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), tool, ...args], {
      cwd: directory,
      env,
      encoding: 'utf8',
    });
  await using _cleanup2 = onAsyncExit(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'dist-desktop'));
  await fs.mkdir(path.join(directory, 'dist-electron'));
  await fs.writeFile(path.join(directory, 'dist-desktop/app.js'), 'original');
  await fs.writeFile(path.join(directory, 'dist-electron/main.cjs'), 'main');
  await fs.writeFile(path.join(directory, 'dist-desktop/.DS_Store'), 'finder-one');
  const proof = (overrides: NodeJS.ProcessEnv = {}) =>
    verifyBuildIdentity({
      root: directory,
      env: { ...env, ...overrides },
      report: () => {},
    });
  await writeBuildIdentity({
    root: directory,
    source: { commit: '0'.repeat(40), dirty: true, sha256: '0'.repeat(64) },
    assets: { identity: '1'.repeat(64), recipe: '2'.repeat(64) },
    report: () => {},
  });
  assert.equal(run().status, 0);
  assert.equal(run(['--write']).status, 1, 'Only supervised builds write identities');
  const identityPath = path.join(directory, 'dist-desktop/build-identity.json'),
    identity = await readJson(identityPath);
  assert.equal(identity.files['dist-desktop/.DS_Store'], undefined);
  await fs.writeFile(path.join(directory, 'dist-desktop/.DS_Store'), 'finder-two');
  await proof();
  await fs.writeFile(path.join(directory, 'dist-desktop/app.js'), 'tampered');
  await assert.rejects(proof(), /build artifact files differ/);
  await fs.writeFile(path.join(directory, 'dist-desktop/app.js'), 'original');
  identity.sourceCommit = 'a'.repeat(40);
  identity.dirty = false;
  await writeJson(identityPath, identity);
  await assert.rejects(proof({ GITHUB_SHA: 'b'.repeat(40) }), /another commit/);
  identity.dirty = true;
  await writeJson(identityPath, identity);
  await assert.rejects(proof({ GITHUB_SHA: identity.sourceCommit }), /clean source identity/);
  identity.dirty = false;
  await writeJson(identityPath, identity);
  await proof({ GITHUB_SHA: identity.sourceCommit });
});
test('smoke profiles never delete user-supplied directories, including on launch failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-profile-review-'));
  await using _cleanup1 = onAsyncExit(() => fs.rm(directory, { recursive: true, force: true }));
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
});

test('headless replay commits death reset requests once and preserves save/load recovery', async () => {
  const initialSave = new GameSession(content).captureSave();
  initialSave.player.health = 0;
  const result = await executeRecipe({
    initialSave,
    actions: [
      { kind: 'step', ticks: 2, command: { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } } },
      { kind: 'save' },
      { kind: 'load' },
    ],
  });
  assert.equal(result.events['room-reset'], 1);
  assert.equal(result.finalSave.player.health, 100);
  assert.equal(result.finalSave.area, initialSave.area);
});

test('headless replay accepts the same ordered actions and potion input as live simulation', async () => {
  const initial = new GameSession(content),
    save = initial.captureSave();
  save.player.health = 20;
  delete save.adventure!.pack;
  save.adventure!.inventory['health-potion'] = 1;
  const command = {
    move: { x: 0, z: 0 },
    aim: { x: 0, z: 1 },
    actions: ['sword', 'dodge', 'lantern'],
    potion: true,
  } satisfies Command;
  initial.restoreSave(save);
  const direct = initial.step(command);
  const result = await executeRecipe({
    initialSave: save,
    actions: [{ kind: 'step', ticks: 1, command }],
  });
  assert.equal(result.events['potion-used'], 1);
  assert.deepEqual(result.finalSave, initial.captureSave());
  for (const event of direct.events) assert.ok(result.events[event.kind], event.kind);
  for (const flag of ['attack', 'ability', 'dodge'])
    await assert.rejects(
      executeRecipe({
        actions: [{ kind: 'step', ticks: 1, command: { ...command, [flag]: true } }],
      }),
      /Unrecognized key/,
    );
});

test('built browser discovery lists loot coverage without a build, preview or asset acquisition', async (t) => {
  const root = await temporaryDirectory(t, 'lantern-browser-discovery-');
  const cache = path.join(root, 'absent-cache');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      'tools/browser-tests.ts',
      'game-loot',
      '--built',
      '--list',
    ],
    {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, LANTERN_CACHE_ROOT: cache, LANTERN_PREVIEW_PORT: 'invalid' },
    },
  );
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.match(output, /game-loot\.spec\.ts/);
  assert.match(output, /Total: [1-9]\d* tests? in 1 file/);
  await assert.rejects(fs.access(cache), { code: 'ENOENT' });
});
