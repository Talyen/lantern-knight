import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { agentContext, contextPaths, taskStartArgs } from '../tools/agent-context';
import { startTask, snapshot, taskBaseline, taskDirectory } from '../tools/task-state';
import {
  formatResult,
  saveResult,
  latestResult,
  boundedText,
  ReportedFailure,
  type CommandResult,
} from '../tools/command-report';
import { runTask, type TaskContext } from '../tools/task-runner';
import { check } from '../tools/check';
import { checkContextRoutes } from '../tools/check-docs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-agent-context-'));
  const write = async (name: string, value: string) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), value);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  await write('src/core/save.ts', 'export const version = 1;');
  await write('tests/persistence.test.ts', "import test from 'node:test';test('fixture',()=>{});");
  git('init', '--quiet');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.');
  git('commit', '--quiet', '-m', 'fixture');
  const context: TaskContext = {
    testRoot: root,
    env: { ...process.env, LANTERN_FULL_VERIFICATION: '0' },
    workspaces: new Map(),
    releaseAdmission: async () => {},
  };
  return {
    root,
    write,
    git,
    context,
    close: async () => {
      await fs.rm(await taskDirectory(root), { recursive: true, force: true });
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
const passed = (command = 'test'): CommandResult => ({
  command,
  scope: 'explicit fixture',
  outcome: 'passed',
  unit: 'checks',
  executed: 1,
  reused: 0,
  failed: 0,
  skipped: 0,
  durationMs: 12,
  selected: ['tests/persistence.test.ts'],
  reasons: ['explicit selection'],
  remaining: ['hosted CI separate'],
  timings: [{ name: 'fixture', ms: 12 }],
});

test('brief routes dirty baselines, explicit discovery paths and deletions without narrowing verification', async () => {
  const f = await fixture();
  try {
    const initial = await agentContext(f.root);
    assert.match(initial.text, /Task: none/);
    assert.match(initial.text, /repository map/);
    await f.write('src/core/save.ts', 'export const version = 2;');
    f.git('mv', 'src/core/save.ts', 'src/core/persistence.ts');
    await startTask(f.root, 'saved-state', ['src/core/persistence.ts']);
    const state = await taskBaseline(f.root);
    assert.equal(state!.inheritedDirty, 1); // Rename has two porcelain fields but one inventory entry.
    assert.match(state!.commit!, /^[a-f0-9]{40}$/);
    assert.match(state!.identity!, /^[a-f0-9]{64}$/);
    const started = await agentContext(f.root);
    assert.equal(started.detail.scopeSource, 'task discovery paths');
    assert.match(started.text, /saved state:/);
    await f.write(
      'tests/new-contract.test.ts',
      "import test from 'node:test';test('new contract',()=>{});",
    );
    await fs.unlink(path.join(f.root, 'src/core/persistence.ts'));
    const changed = await agentContext(f.root);
    assert.ok(changed.detail.scope.includes('src/core/persistence.ts'));
    assert.ok(changed.detail.verification.plan.suites.includes('tests/new-contract.test.ts'));
    const explicit = await agentContext(f.root, ['src/core/save.ts']);
    assert.deepEqual(explicit.detail.scope, ['src/core/save.ts']);
    assert.ok(explicit.detail.verification.plan.changed.includes('tests/new-contract.test.ts'));
    assert.ok(explicit.text.split(/\s+/).length <= 450);
    assert.throws(() => contextPaths(f.root, ['../escape']), /inside the checkout/);
    assert.throws(() => taskStartArgs(['name', '--paths'], f.root), /task:start/);
    assert.throws(() => taskStartArgs(['name', '--paths', '--unknown'], f.root), /agent:context/);
  } finally {
    await f.close();
  }
});

test('brief distinguishes current, reused, failed, stale, unrelated and expired evidence', async () => {
  const f = await fixture();
  try {
    const inputs = await snapshot(f.root);
    await saveResult(f.root, passed(), inputs);
    assert.match(
      (await agentContext(f.root, ['src/core/save.ts'])).text,
      /current passing evidence/,
    );
    await saveResult(f.root, { ...passed(), executed: 0, reused: 1 }, inputs);
    assert.match((await agentContext(f.root)).text, /reusable prior passing evidence/);
    await saveResult(f.root, { ...passed(), outcome: 'failed', failed: 1 }, inputs);
    assert.match((await agentContext(f.root)).text, /failure; no passing claim/);
    await f.write('src/core/new.ts', 'export {};');
    assert.equal((await latestResult(f.root))!.matching, false);
    assert.match((await agentContext(f.root)).text, /stale/);
    await saveResult(f.root, passed(), await snapshot(f.root), ['tests/persistence.test.ts']);
    assert.match(
      (await agentContext(f.root, ['src/core/save.ts'])).text,
      /not performed for this scope/,
    );
    await saveResult(
      f.root,
      { ...passed(), outcome: 'not-run', executed: 0 },
      await snapshot(f.root),
    );
    assert.match((await agentContext(f.root)).text, /not performed \(no tests selected\)/);
    const last = await latestResult(f.root);
    const corrupt = JSON.parse(await fs.readFile(last!.file, 'utf8'));
    corrupt.result.outcome = 'passed';
    corrupt.result.failed = 1;
    await fs.writeFile(last!.file, JSON.stringify(corrupt));
    assert.equal(await latestResult(f.root), undefined);
    await fs.unlink(last!.file);
    assert.match((await agentContext(f.root)).text, /not performed or expired/);
  } finally {
    await f.close();
  }
});

test('fresh/reused test output is bounded and source edits invalidate counts without replaying timings', async () => {
  const f = await fixture();
  try {
    let output = '';
    const run = () =>
      runTask(f.context, 'test', ['tests/persistence.test.ts'], (chunk) => {
        output += chunk;
      });
    await run();
    assert.match(output, /1 executed; 0 reused/);
    assert.ok(Buffer.byteLength(output) <= 1200);
    assert.ok(output.trim().split('\n').length <= 8);
    output = '';
    await run();
    assert.match(output, /0 executed; 1 reused/);
    assert.match(output, /Prior passing evidence reused/);
    assert.doesNotMatch(output, /Running|Unit timing/);
    const latest = await latestResult(f.root);
    assert.equal(latest!.result.timings.length, 1);
    await f.write(
      'tests/persistence.test.ts',
      "import test from 'node:test';test('changed fixture',()=>{});",
    );
    output = '';
    await run();
    assert.match(output, /1 executed; 0 reused/);
    output = '';
    await runTask(f.context, 'test:full', [], (chunk) => {
      output += chunk;
    });
    assert.match(output, /1 executed; 0 reused/);
    assert.match(output, /test:full/);
  } finally {
    await f.close();
  }
});

test('execution deadlines produce failed reports and never a passing receipt', async () => {
  const f = await fixture();
  try {
    await f.write(
      'tests/persistence.test.ts',
      "import test from 'node:test';test('hang',async()=>new Promise(()=>{}));",
    );
    f.context.env.LANTERN_EXECUTION_DEADLINE = String(Date.now() + 300);
    await assert.rejects(
      runTask(f.context, 'test', ['tests/persistence.test.ts'], () => {}),
      /deadline/,
    );
    assert.equal((await latestResult(f.root))!.result.outcome, 'failed');
    const records = await fs.readdir(await taskDirectory(f.root));
    assert.ok(!records.some((name) => name.startsWith('phase-')));
  } finally {
    await f.close();
  }
});

test('composite failure prints one authoritative report and retains all assertions externally', async () => {
  const f = await fixture();
  try {
    await startTask(f.root, 'failure');
    await f.write(
      'tests/persistence.test.ts',
      "import test from 'node:test';import assert from 'node:assert/strict';for(let i=0;i<4;i++)test('failure '+i,()=>assert.equal('actual','expected')); ",
    );
    let output = '';
    await assert.rejects(
      check(
        f.root,
        [],
        async (name, _args, sink) => {
          if (name === 'tests')
            return runTask(f.context, 'test', ['tests/persistence.test.ts'], sink);
        },
        false,
        (chunk) => {
          output += chunk;
        },
      ),
      ReportedFailure,
    );
    assert.equal((output.match(/Details:/g) ?? []).length, 1);
    assert.match(output, /actual/);
    assert.match(output, /expected/);
    const result = await latestResult(f.root);
    assert.equal(result!.result.command, 'check');
    const log = await fs.readFile(result!.result.diagnostics!, 'utf8');
    assert.match(log, /failure 3/);
    assert.ok(result!.result.failures!.length <= 3);
    assert.equal(result!.result.outcome, 'failed');
  } finally {
    await f.close();
  }
});

test('formatting bounds Unicode failure excerpts and routing references stay valid', async () => {
  const long = 'assert expected actual 🕯 '.repeat(1000);
  const output = formatResult(
    { ...passed(), outcome: 'failed', failures: [long, long, long, long] },
    '/external/details.json',
  );
  assert.ok(Buffer.byteLength(output.split('Details: /external/details.json\n')[1]!) <= 4000);
  assert.doesNotMatch(boundedText(long, 500), /\uFFFD/);
  assert.deepEqual(await checkContextRoutes(process.cwd()), []);
});
