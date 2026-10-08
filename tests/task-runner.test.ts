import { sceneOptions } from '../tools/scene-workflow';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../tools/run-process';
import { withoutCommandLane } from '../tools/command-lane';
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
    ['assets:inspect', ['constructor']],
    ['assets:inspect', ['missing-asset']],
    ['constructor', []],
  ] as [string, string[]][]) {
    await assert.rejects(runTask(context, task, args));
    assert.equal(context.workspaces.size, 0);
    assert.deepEqual(context.captureDirectories, ['/fixture/capture']);
  }
  {
    assert.deepEqual(sceneOptions(['--scene', 'court', '--capture', '--local']), {
      scene: 'court',
      capture: true,
      local: true,
      skipReload: false,
    });
    for (const args of [
      [],
      ['--scene', 'unknown'],
      ['--scene'],
      ['--scene', 'court', '--skip-tests'],
      ['--scene', 'court', '--scene', 'court'],
    ])
      assert.throws(() => sceneOptions(args));
  }
});

test('a focused pure run executes one small fixture with an unusable asset cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-runner-fixture-'));
  try {
    await fs.mkdir(path.join(root, 'tests'));
    await fs.writeFile(
      path.join(root, 'tests/persistence.test.ts'),
      `import test from 'node:test';import fs from 'node:fs/promises';test('runs exactly once',async()=>{await fs.appendFile('.ran','once');});`,
    );
    const context: TaskContext = {
      testRoot: root,
      env: { ...process.env, LANTERN_CACHE_ROOT: process.cwd() },
      workspaces: new Map(),
      releaseAdmission: async () => {},
    };
    let output = '';
    await runTask(context, 'test', ['tests/persistence.test.ts'], (chunk) => {
      output += chunk.toString();
    });
    assert.equal(context.workspaces.size, 0);
    assert.match(output, /1 suite; 1 checks passed; 0 failed/);
    assert.equal(await fs.readFile(path.join(root, '.ran'), 'utf8'), 'once');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  const { testGroups } = await import('../tools/test');
  const { commands, checkCommandScripts } = await import('../tools/task-runner');
  assert.deepEqual(testGroups(['tests/hero-actions.test.ts', 'tests/unknown.test.ts']), {
    pure: ['tests/hero-actions.test.ts'],
    assets: ['tests/unknown.test.ts'],
  });

  await assert.rejects(
    checkCommandScripts({ invalid: 'tsx tools/task-runner.ts missing' }),
    /Unregistered/,
  );
  await assert.rejects(
    checkCommandScripts({ constructor: 'tsx tools/task-runner.ts constructor' }),
    /Unregistered/,
  );
});
test('invalid managed requests reject before contacting the occupied command lane', async () => {
  let output = '';
  await assert.rejects(
    runProcess(
      process.execPath,
      ['--import', 'tsx', 'tools/task-runner.ts', 'test', 'tests/missing.test.ts'],
      {
        cwd: process.cwd(),
        env: withoutCommandLane(process.env),
        timeoutMs: 2000,
        output: (chunk) => {
          output += chunk.toString();
        },
      },
    ),
  );
  assert.match(output, /Invalid test selection/);
  assert.doesNotMatch(output, /Waiting for|Command admission|Asset setup/);
});

test('aggregate execution clocks expire across phases and cannot be reset by nested tasks', async () => {
  const { executionDeadline } = await import('../tools/task-budget');
  const deadline = executionDeadline(750, undefined, Date.now());
  const env = { ...process.env, LANTERN_EXECUTION_DEADLINE: deadline };
  assert.equal(executionDeadline(5000, deadline), deadline);
  await runProcess(process.execPath, ['-e', 'setTimeout(()=>{},120)'], { cwd: process.cwd(), env });
  let output = '';
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'console.log(process.pid);setInterval(()=>{},1000)'], {
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
      output: (chunk) => {
        output += chunk.toString();
      },
    }),
    /deadline exceeded/,
  );
  const pid = Number(output.trim());
  assert.ok(pid > 0);
  assert.throws(
    () => process.kill(pid, 0),
    (error: NodeJS.ErrnoException) => error.code === 'ESRCH',
  );
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.exit(0)'], {
      cwd: process.cwd(),
      env,
    }),
    /deadline exceeded before launch/,
  );
});

test('empty or failed test workers cannot produce successful focused evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-empty-test-'));
  try {
    await fs.mkdir(path.join(root, 'tests'));
    const file = path.join(root, 'tests/persistence.test.ts');
    const context: TaskContext = {
      testRoot: root,
      env: { ...process.env },
      workspaces: new Map(),
      releaseAdmission: async () => {},
    };
    await fs.writeFile(file, 'export {};');
    await assert.rejects(
      runTask(context, 'test', ['tests/persistence.test.ts'], () => {}),
      /executed no checks/,
    );
    await fs.writeFile(
      file,
      `import test from 'node:test';test('known failure',()=>{throw new Error('regression');});`,
    );
    await assert.rejects(
      runTask(context, 'test', ['tests/persistence.test.ts'], () => {}),
      /Tests failed/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
