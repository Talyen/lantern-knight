import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  affectedVerification,
  verificationPlan,
  changedInputs,
  ciDesktopRequired,
} from '../tools/verification-plan';
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

test('reverse dependencies preserve transitive type, re-export, dynamic and authored JSON consumers', async () => {
  const f = await fixture();
  try {
    const files = new Map([
      ['src/core/value.ts', 'export type Value = number;'],
      ['src/core/barrel.ts', "export type { Value } from './value';"],
      [
        'src/core/model.ts',
        "import type { Value } from './barrel'; import data from '../../authoring/model.json'; export const value: Value = data.value;",
      ],
      ['tests/systems.test.ts', "void import('../src/core/model');"],
      ['tests/persistence.test.ts', 'export {};'],
      ['authoring/model.json', '{"value":1}'],
    ]);
    for (const changed of ['src/core/value.ts', 'authoring/model.json']) {
      const plan = affectedVerification(f.root, 'baseline', [changed], files, files);
      assert.equal(plan.full, false);
      assert.deepEqual(plan.suites, ['tests/systems.test.ts']);
      assert.equal(plan.desktop, true);
    }
    const before = new Map(files),
      after = new Map(files);
    after.delete('src/core/value.ts');
    after.set('src/core/renamed.ts', 'export type Value = number;');
    after.set('src/core/barrel.ts', "export type { Value } from './renamed';");
    assert.deepEqual(
      affectedVerification(
        f.root,
        'baseline',
        ['src/core/value.ts', 'src/core/renamed.ts'],
        after,
        before,
      ).suites,
      ['tests/systems.test.ts'],
    );
    after.set('src/core/barrel.ts', 'export type Value = number;');
    after.delete('src/core/renamed.ts');
    assert.deepEqual(
      affectedVerification(f.root, 'baseline', ['src/core/value.ts'], after, before).suites,
      ['tests/systems.test.ts'],
    );
  } finally {
    await f.close();
  }
});

test('subprocess, Python wrappers and file fixtures have consumers without importing them', async () => {
  const f = await fixture();
  try {
    const files = new Map([
      ['tests/library-import.test.ts', 'export {};'],
      ['tests/processes.test.ts', 'export {};'],
      ['tests/compiler.test.ts', 'export {};'],
      ['tests/persistence.test.ts', 'export {};'],
      ['tests/launcher.test.ts', "const tool = 'tools/tool.ts';"],
      ['tools/tool.ts', 'export {};'],
      ['tools/assets/library_import.py', 'pass'],
      ['authoring/session-opening.json', '{}'],
      ['tests/fixtures/valid.json', '{}'],
      ['tests/text-fixture.test.ts', "const fixture = 'tests/fixtures/recipe.txt';"],
      ['tests/fixtures/recipe.txt', 'authored fixture'],
    ]);
    for (const [file, expected] of [
      ['tools/assets/library_import.py', 'tests/library-import.test.ts'],
      ['authoring/session-opening.json', 'tests/processes.test.ts'],
      ['tests/fixtures/valid.json', 'tests/compiler.test.ts'],
      ['tools/tool.ts', 'tests/launcher.test.ts'],
      ['tests/fixtures/recipe.txt', 'tests/text-fixture.test.ts'],
    ]) {
      const plan = affectedVerification(f.root, 'baseline', [file!], files, files);
      assert.equal(plan.full, false);
      assert.deepEqual(plan.suites, [expected]);
    }
  } finally {
    await f.close();
  }
});

test('emitted JavaScript imports select their TypeScript source before a same-named JavaScript file', async () => {
  const f = await fixture();
  try {
    const files = new Map([
      ['src/core/value.ts', 'export {};'],
      ['src/core/value.js', 'export {};'],
      ['tests/systems.test.ts', "import '../src/core/value.js';"],
      ['tests/persistence.test.ts', 'export {};'],
    ]);
    const plan = affectedVerification(f.root, 'baseline', ['src/core/value.ts'], files, files);
    assert.equal(plan.full, false);
    assert.deepEqual(plan.suites, ['tests/systems.test.ts']);
    await f.write(
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { paths: { '@core/*': ['src/core/*'] } } }),
    );
    await f.baseline();
    await f.write('tests/persistence.test.ts', 'export {};');
    assert.equal((await verificationPlan(f.root)).full, true);
  } finally {
    await f.close();
  }
});

test('unknown, unresolved, computed, shared and deleted-suite changes broaden coverage', async () => {
  const f = await fixture();
  try {
    const files = new Map([
      ['tests/persistence.test.ts', 'export {};'],
      ['tests/systems.test.ts', "import '../src/missing';"],
      ['src/core/value.ts', 'export {};'],
    ]);
    for (const changed of [
      '.oxlintrc.json',
      'knip.json',
      'ruff.toml',
      'tools/lint.ts',
      'tools/code-tools.ts',
      'tools/future.py',
      'package.json',
      'tools/test.ts',
      'src/core/value.ts',
    ]) {
      const plan = affectedVerification(f.root, 'baseline', [changed], files, files);
      assert.equal(plan.full, true);
      assert.equal(plan.suites.length, 2);
      assert.equal(plan.desktop, true);
    }
    const resolved = new Map(files);
    resolved.set(
      'tests/systems.test.ts',
      "import '../src/core/value'; void import(location.hash);",
    );
    assert.equal(
      affectedVerification(f.root, 'baseline', ['src/core/value.ts'], resolved, resolved).full,
      true,
    );
    const deleted = new Map(files);
    deleted.delete('tests/systems.test.ts');
    assert.deepEqual(
      affectedVerification(f.root, 'baseline', ['tests/systems.test.ts'], deleted, files).suites,
      ['tests/persistence.test.ts'],
    );
  } finally {
    await f.close();
  }
});

test('local scope includes committed changes, staged reversals, untracked files and both rename/deletion paths', async () => {
  const f = await fixture();
  try {
    await f.write('src/core/value.ts', 'export const value = 1;');
    await f.write('tests/systems.test.ts', "import '../src/core/value';");
    await f.write('old name.txt', 'rename');
    await f.write('deleted.txt', 'delete');
    const base = await f.baseline();
    await f.write('src/core/value.ts', 'export const value = 2;');
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
      'src/core/value.ts',
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
      env: { ...process.env, LANTERN_CACHE_ROOT: process.cwd() },
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

test('finite E2E dispatch retains phase edges while dispatcher edits always request full verification', async () => {
  const f = await fixture();
  try {
    const files = new Map([
      ['src/core/input.ts', 'export {};'],
      ['tools/smoke/game-smoke.ts', "import '../../src/core/input';"],
      [
        'tools/smoke/e2e.ts',
        "const phases = ['./game-smoke.ts']; for (const module of phases) await import(module);",
      ],
      ['tests/systems.test.ts', "import '../src/core/input';"],
      ['tests/persistence.test.ts', 'export {};'],
    ]);
    const plan = affectedVerification(f.root, 'baseline', ['src/core/input.ts'], files, files);
    assert.equal(plan.full, false);
    assert.deepEqual(plan.suites, ['tests/systems.test.ts']);
    assert.equal(plan.desktop, true);
    assert.equal(
      affectedVerification(f.root, 'baseline', ['tools/smoke/e2e.ts'], files, files).full,
      true,
    );
  } finally {
    await f.close();
  }
});
