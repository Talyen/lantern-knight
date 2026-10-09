import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { verificationPlan, changedInputs, ciDesktopRequired } from '../tools/verification-plan';
import { runChecks } from '../tools/check';
import { runTask, parseTask, type TaskContext } from '../tools/task-runner';
import { startTask, taskBaseline } from '../tools/task-state';

test('focused checks reject new inputs added after their gates and do not advance the baseline', async () => {
  const f = await fixture();
  try {
    await f.baseline();
    await startTask(f.root, 'stable-check');
    await f.write('README.md', 'Changed documentation');
    const result = await runChecks(f.root, async (name) => {
      if (name === 'whitespace') await f.write('src/new.ts', 'export const value = 1;');
    });
    assert.equal(result.passed, false);
    assert.equal(result.steps.at(-1)!.name, 'source stability');
    assert.equal(result.steps.at(-1)!.status, 'failed');
    assert.equal((await taskBaseline(f.root))!.checked, undefined);
  } finally {
    await f.close();
  }
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-selection-'));
  const write = async (file: string, text: string) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), text);
  };
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  await write('tests/persistence.test.ts', "import test from 'node:test'; test('fixture',()=>{});");
  return {
    root,
    write,
    git,
    close: () => fs.rm(root, { recursive: true, force: true }),
    async baseline() {
      git('init', '--quiet');
      git('config', 'user.name', 'Fixture');
      git('config', 'user.email', 'fixture@example.invalid');
      git('add', '.');
      git('commit', '--quiet', '-m', 'baseline');
      const base = git('rev-parse', 'HEAD');
      git('update-ref', 'refs/remotes/origin/main', base);
      return base;
    },
  };
}

test('local scope includes committed changes, staged reversals, untracked files and both rename/deletion paths', async () => {
  const f = await fixture();
  try {
    await f.write('src/core/input.ts', 'export const value = 1;');
    await f.write('tests/systems.test.ts', "import '../src/core/value';");
    await f.write('old name.txt', 'rename');
    await f.write('deleted.txt', 'delete');
    const base = await f.baseline();
    await f.write('src/core/input.ts', 'export const value = 2;');
    f.git('add', '.');
    f.git('commit', '--quiet', '-m', 'local change');
    const committed = await verificationPlan(f.root);
    assert.equal(committed.base, base);
    assert.deepEqual(committed.suites, ['tests/systems.test.ts']);
    await f.write('tests/persistence.test.ts', 'export {};');
    f.git('add', 'tests/persistence.test.ts');
    await f.write(
      'tests/persistence.test.ts',
      "import test from 'node:test'; test('fixture',()=>{});",
    );
    await f.write('tests/untracked.test.ts', 'export {};');
    f.git('mv', 'old name.txt', 'new name.txt');
    await fs.unlink(path.join(f.root, 'deleted.txt'));
    assert.deepEqual(changedInputs(f.root).changed, [
      'deleted.txt',
      'new name.txt',
      'old name.txt',
      'src/core/input.ts',
      'tests/persistence.test.ts',
      'tests/untracked.test.ts',
    ]);
    assert.deepEqual((await verificationPlan(f.root)).suites, [
      'tests/persistence.test.ts',
      'tests/systems.test.ts',
      'tests/untracked.test.ts',
    ]);
  } finally {
    await f.close();
  }
});

test('clean/doc-only checks execute no tests or pack gate; full and missing-history requests retain all suites', async () => {
  const f = await fixture();
  try {
    await f.baseline();
    assert.deepEqual((await verificationPlan(f.root)).suites, []);
    await f.write('README.md', '# Documentation');
    assert.equal((await verificationPlan(f.root)).desktop, false);
    const executed: string[] = [];
    const local = await runChecks(f.root, async (name) => {
      executed.push(name);
    });
    assert.equal(local.passed, true);
    assert.ok(!executed.includes('asset pin'), 'Documentation does not require publication');
    assert.ok(!executed.includes('tests'));
    assert.ok(!executed.includes('assets'));
    assert.equal(local.steps.find((step) => step.name === 'tests')!.status, 'skipped');
    await f.write('README.md', 'Next documentation edit');
    const changed = await runChecks(f.root, async (name) => {
      if (name === 'documentation') await f.write('README.md', 'Changed during verification');
    });
    assert.equal(changed.passed, false);
    const full = await runChecks(
      f.root,
      async (name, args) => {
        if (name === 'tests') assert.deepEqual(args, ['run', 'test:full']);
      },
      false,
      true,
    );
    assert.equal(full.passed, true);
    assert.ok(full.steps.some((step) => step.name === 'assets'));
    f.git('update-ref', '-d', 'refs/remotes/origin/main');
    assert.equal((await verificationPlan(f.root)).full, true);
    assert.deepEqual((await verificationPlan(f.root, { full: true })).suites, [
      'tests/persistence.test.ts',
    ]);
    await fs.rm(path.join(f.root, '.git'), { recursive: true });
    assert.equal((await verificationPlan(f.root)).full, true);
  } finally {
    await f.close();
  }
});

test('automatic pure runs and full commands use managed supervision without an asset workspace', async () => {
  const f = await fixture();
  try {
    await f.baseline();
    await f.write(
      'tests/persistence.test.ts',
      "import test from 'node:test'; test('changed fixture',()=>{});",
    );
    const context: TaskContext = {
      testRoot: f.root,
      env: { ...process.env, LANTERN_ASSET_WORKSPACE: '/unavailable-artwork' },
      workspaces: new Map(),
      releaseAdmission: async () => {},
    };
    for (const task of ['test', 'test:full']) {
      let output = '';
      await runTask(context, task, [], (chunk) => {
        output += chunk;
      });
      assert.match(output, /1 suite;.*\n1 executed; 0 reused; 0 failed/);
      assert.equal(context.workspaces.size, 0);
    }
    for (const task of ['test:full', 'check:full'])
      await assert.rejects(parseTask(task, ['tests/persistence.test.ts'], f.root));
    f.git('checkout', '--', 'tests/persistence.test.ts');
    let output = '';
    await runTask(context, 'test', [], (chunk) => {
      output += chunk;
    });
    assert.match(output, /NOT RUN: test; 0 suites/);
    assert.doesNotMatch(output, /PASSED: test/);
  } finally {
    await f.close();
  }
});

test('CI skips desktop only for demonstrated independent PRs, never main/manual or unknown bases', async () => {
  const f = await fixture();
  try {
    await f.write('tools/independent.ts', 'export const value = 1;');
    await f.write('tests/systems.test.ts', "import '../tools/independent';");
    const base = await f.baseline();
    await f.write('README.md', '# Documentation');
    assert.equal(await ciDesktopRequired(f.root, 'pull_request', base), false);
    for (const event of ['push', 'workflow_dispatch'])
      assert.equal(await ciDesktopRequired(f.root, event, base), true);
    for (const ref of [undefined, 'invalid', 'f'.repeat(40)])
      assert.equal(await ciDesktopRequired(f.root, 'pull_request', ref), true);
    await f.write('tools/independent.ts', 'export const value = 2;');
    assert.equal(await ciDesktopRequired(f.root, 'pull_request', base), false);
    await f.write('src/main.ts', 'export {};');
    assert.equal(await ciDesktopRequired(f.root, 'pull_request', base), true);
  } finally {
    await f.close();
  }
});

test('scene layout edits select contract checks and unknown executable inputs remain conservative', async () => {
  const f = await fixture();
  try {
    await f.write(
      'tests/scene-design.test.ts',
      "import test from 'node:test';test('contract',()=>{});",
    );
    await f.write(
      'tests/scene-editor.test.ts',
      "import test from 'node:test';test('editor',()=>{});",
    );
    await f.write('authoring/scenes/draft.json', '{"objects":[]}');
    await f.baseline();
    await f.write('authoring/scenes/draft.json', '{"objects":[{"x":4}]}');
    const plan = await verificationPlan(f.root);
    assert.equal(plan.full, false);
    assert.deepEqual(plan.suites, ['tests/scene-design.test.ts', 'tests/scene-editor.test.ts']);
    await f.write('tests/fixtures/arena.ts', 'export const position = 2;');
    assert.equal(
      (await verificationPlan(f.root)).full,
      true,
      'Shared test fixtures select all consumers',
    );
    await fs.rm(path.join(f.root, 'tests/fixtures/arena.ts'));
    await f.write('future.ts', 'export {};');
    assert.equal((await verificationPlan(f.root)).full, true);
    assert.equal((await verificationPlan(f.root)).suites.length, 3);
  } finally {
    await f.close();
  }
});
