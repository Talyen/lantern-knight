import { e2e } from '../tools/delivery';
import { sceneOptions } from '../tools/scene/scene-workflow';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../tools/run-process';
import { withoutCommandLane } from '../tools/command-lane';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTask, parseTask, type TaskContext } from '../tools/task-runner';
import { runTests } from '../tools/test';

test('asset-backed workers inherit runner admission when workspace setup has no lane credentials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-worker-admission-'));
  try {
    await fs.mkdir(path.join(root, 'tests'));
    await fs.writeFile(
      path.join(root, 'tests/unknown.test.ts'),
      "import test from 'node:test';test('asset-independent worker fixture',()=>{});",
    );
    const result = await runTests(
      ['tests/unknown.test.ts'],
      async () => ({
        ...withoutCommandLane(process.env),
        LANTERN_EXECUTION_DEADLINE: String(Date.now() + 4000),
        LANTERN_ASSET_WORKSPACE: '/unused-fixture-artwork',
      }),
      undefined,
      root,
    );
    assert.equal(result.passed, 1);
    assert.equal(result.failed, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('explicit local browser verification consumes the candidate rather than a cached prototype layer', async () => {
  const context: TaskContext = {
    env: {},
    workspaces: new Map<
      'published' | 'candidate' | 'preview',
      { env: NodeJS.ProcessEnv; release: () => Promise<void> }
    >([
      ['candidate', { env: { LANTERN_ASSET_SHA256: 'candidate' }, release: async () => {} }],
      ['preview', { env: { LANTERN_ASSET_SHA256: 'prototype' }, release: async () => {} }],
    ]),
    releaseAdmission: async () => {},
  };
  const parsed = await parseTask('ui:probe', ['--local']);
  const definition = {
    ...parsed.definition,
    operation: async ({ env }: { env: NodeJS.ProcessEnv }) => {
      assert.equal(env.LANTERN_ASSET_SHA256, 'candidate');
    },
  };
  await runTask(context, 'ui:probe', ['--local'], undefined, { ...parsed, definition });
});
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
    ['lint', ['--unsafe-fixes']],
    ['lint:js', ['--fix', '--fix']],
    ['lint:py', ['--unknown']],
    ['knip', ['--fix']],
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
      env: { ...process.env, LANTERN_ASSET_WORKSPACE: '/unavailable-artwork' },
      workspaces: new Map(),
      releaseAdmission: async () => {},
    };
    let output = '';
    await runTask(context, 'test', ['tests/persistence.test.ts'], (chunk) => {
      output += chunk.toString();
    });
    assert.equal(context.workspaces.size, 0);
    assert.match(output, /1 suite;.*\n1 executed; 0 reused; 0 failed/);
    assert.equal(await fs.readFile(path.join(root, '.ran'), 'utf8'), 'once');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  const { testGroups } = await import('../tools/test');
  const { checkCommandScripts } = await import('../tools/task-runner');
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
      /regression/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('full delivery flags reach journeys without leaking into build verification', async () => {
  const verified: string[] = [];
  let journeys = false;
  await e2e({
    run: async (name, args = []) => {
      await parseTask(name, args);
      verified.push(name);
    },
    args: ['--full'],
    clean: ['--full'],
    child: async (file, args) => {
      assert.equal(file, 'tools/smoke/e2e.ts');
      assert.deepEqual(args, ['--full']);
      journeys = true;
    },
  });
  assert.deepEqual(verified, ['build:verify', 'build:dev:verify']);
  assert.equal(journeys, true);
});

test('composite verification shares typecheck evidence without mutating the process asset environment', async () => {
  const context: TaskContext = {
    env: { ...process.env, LANTERN_ASSET_SHA256: 'invocation-assets' },
    workspaces: new Map(),
    releaseAdmission: async () => {},
  };
  const initial = process.env.LANTERN_ASSET_SHA256;
  const parsed = await parseTask('verify:build');
  const output: string[] = [];
  await runTask(context, 'verify:build', [], undefined, {
    ...parsed,
    definition: {
      ...parsed.definition,
      operation: async ({ run, env }) => {
        assert.equal(env.LANTERN_ASSET_SHA256, 'invocation-assets');
        assert.equal(process.env.LANTERN_ASSET_SHA256, initial);
        for (let i = 0; i < 2; i++) {
          let log = '';
          await run('typecheck', [], (chunk) => {
            log += chunk.toString();
          });
          output.push(log);
        }
      },
    },
  });
  assert.match(output[0]!, /1 executed; 0 reused/);
  assert.match(output[1]!, /0 executed; 1 reused/);
  assert.equal(process.env.LANTERN_ASSET_SHA256, initial);
  for (const retired of ['smoke:art', 'assets:publish'])
    await assert.rejects(parseTask(retired), /Unknown managed task/);
});
