import test from 'node:test';
import assert from 'node:assert/strict';
import { runTask, type TaskContext } from '../tools/task-runner';
test('invalid tasks, test selections and reload reuse fail before acquiring an asset workspace', async () => {
  const context: TaskContext = {
    captureDirectories: ['/fixture/capture'],
    env: {},
    workspaces: new Map(),
    releaseAdmission: async () => {
      throw new Error('Unexpected release');
    },
  };
  for (const [task, args] of [
    ['test', ['tests/missing.test.ts']],
    ['build', ['--unknown']],
    ['scene:check', ['--scene', 'court', '--skip-reload']],
    ['scene:unknown', ['--scene', 'court']],
    ['package:arbitrary', []],
    ['constructor', []],
  ] as [string, string[]][]) {
    await assert.rejects(runTask(context, task, args));
    assert.equal(context.workspaces.size, 0);
    assert.deepEqual(context.captureDirectories, ['/fixture/capture']);
  }
});

test('independent suites require no pin and unknown suites remain asset-backed', async () => {
  const { testGroups } = await import('../tools/test');
  const { commands, checkCommandScripts } = await import('../tools/task-runner');
  assert.deepEqual(testGroups(['tests/hero-actions.test.ts', 'tests/unknown.test.ts']), {
    pure: ['tests/hero-actions.test.ts'],
    assets: ['tests/unknown.test.ts'],
  });
  assert.equal(commands.smoke, commands['smoke:desktop']);
  assert.equal(commands['assets:publish'], commands['assets:finalize']);
  await assert.rejects(
    checkCommandScripts({ invalid: 'tsx tools/task-runner.ts missing' }),
    /Unregistered/,
  );
  await assert.rejects(
    checkCommandScripts({ constructor: 'tsx tools/task-runner.ts constructor' }),
    /Unregistered/,
  );
});

test('a focused pure run succeeds with an unusable asset cache and never acquires a workspace', async () => {
  const context: TaskContext = {
    env: { ...process.env, LANTERN_CACHE_ROOT: process.cwd() },
    workspaces: new Map(),
    releaseAdmission: async () => {},
  };
  let output = '';
  await runTask(context, 'test', ['tests/persistence.test.ts'], (chunk) => {
    output += chunk.toString();
  });
  assert.equal(context.workspaces.size, 0);
  assert.match(output, /1 suite; \d+ checks passed; 0 failed/);
});
