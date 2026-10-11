import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const cli = path.resolve('tools/integration-lock.ts');

async function fixture(t: test.TestContext) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-integration-')));
  const main = path.join(root, 'main'),
    task = path.join(root, 'task');
  await fs.mkdir(main);
  const git = (args: string[], cwd = main) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-b', 'main']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--allow-empty',
    '-m',
    'base',
  ]);
  git(['worktree', 'add', '-b', 'task', task]);
  const processes: { child: ReturnType<typeof spawn>; done: Promise<number | null> }[] = [];
  t.after(async () => {
    for (const { child } of processes) if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.all(processes.map(({ done }) => done));
    await fs.rm(root, { recursive: true, force: true });
  });
  const run = (code: string, cwd = task, keepWorktree = false) => {
    // Fixture repositories own independent locks, even when check runs during real integration.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_WORKTREE_ARCHIVE_ROOT: path.join(root, 'archives'),
    };
    delete env.LANTERN_INTEGRATION_LOCK;
    const child = spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        cli,
        ...(keepWorktree ? ['--keep-worktree'] : []),
        process.execPath,
        '-e',
        code,
      ],
      {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const done = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    processes.push({ child, done });
    return { child, done, output: () => output };
  };
  return { root, main, task, git, run };
}

async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    assert.ok(Date.now() < deadline, 'timed out waiting for integration process');
    await delay(20);
  }
}

test(
  'worktrees serialize main integration, including subprocess shutdown, and release after failure',
  { timeout: 20_000 },
  async (t) => {
    const { root, main, task, run } = await fixture(t);
    const started = path.join(root, 'started'),
      stopped = path.join(root, 'stopped'),
      next = path.join(root, 'next');
    const first = run(`
    const fs = require('node:fs');
    fs.writeFileSync(${JSON.stringify(started)}, process.cwd());
    const timer = setInterval(() => {}, 1000);
    process.on('SIGTERM', () => setTimeout(() => {
      fs.writeFileSync(${JSON.stringify(stopped)}, 'stopped');
      clearInterval(timer);
    }, 150));
  `);
    await until(async () =>
      fs.access(started).then(
        () => true,
        () => false,
      ),
    );
    assert.equal(
      await fs.readFile(started, 'utf8'),
      main,
      'command runs in main, not the task checkout',
    );
    const second = run(
      `
    const fs = require('node:fs');
    if (!fs.existsSync(${JSON.stringify(stopped)})) process.exit(9);
    fs.writeFileSync(${JSON.stringify(next)}, 'entered');
  `,
      main,
    );
    await until(() => second.output().includes('Waiting for the local main integration lane'));
    assert.equal(
      await fs.access(next).then(
        () => true,
        () => false,
      ),
      false,
      'waiting command must not start',
    );
    first.child.kill('SIGTERM');
    assert.equal(await first.done, 1, first.output());
    assert.equal(await second.done, 0, second.output());
    assert.equal(await fs.readFile(next, 'utf8'), 'entered');
    const failed = run('process.exit(7)', task);
    assert.equal(await failed.done, 1, failed.output());
    const recovered = run('process.exit(0)', main);
    assert.equal(await recovered.done, 0, recovered.output());
  },
);

test(
  'dirty or missing main never starts integration or changes unfinished work',
  { timeout: 15_000 },
  async (t) => {
    const { root, main, git, run } = await fixture(t);
    const marker = path.join(root, 'executed'),
      unfinished = path.join(main, 'unfinished.txt');
    await fs.writeFile(unfinished, 'another task');
    git(['add', 'unfinished.txt']);
    const before = git(['diff', '--cached']);
    const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`;
    const dirty = run(code);
    assert.equal(await dirty.done, 1);
    assert.match(dirty.output(), /main has unfinished changes/);
    assert.equal(git(['diff', '--cached']), before);
    assert.equal(await fs.readFile(unfinished, 'utf8'), 'another task');
    git(['switch', '-c', 'other']);
    const missing = run(code);
    assert.equal(await missing.done, 1);
    assert.match(missing.output(), /main must be checked out/);
    assert.equal(
      await fs.access(marker).then(
        () => true,
        () => false,
      ),
      false,
    );
  },
);

test('successful task integration archives local evidence and dependencies without touching peers', async (t) => {
  const { root, task, git, run } = await fixture(t);
  git(['branch', '-m', 'codex/task'], task);
  await fs.writeFile(path.join(task, '.gitignore'), 'node_modules/\nevidence\n');
  git(['add', '.gitignore'], task);
  git(
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'task'],
    task,
  );
  await fs.writeFile(path.join(task, 'evidence'), 'local evidence');
  await fs.mkdir(path.join(task, 'node_modules'));
  await fs.writeFile(path.join(task, 'node_modules', 'cache'), 'rebuildable');
  const peer = path.join(root, 'peer');
  git(['worktree', 'add', '-b', 'codex/peer', peer]);
  await fs.writeFile(path.join(peer, 'unfinished'), 'peer work');
  const failed = run('process.exit(7)');
  assert.equal(await failed.done, 1);
  assert.equal(await fs.readFile(path.join(task, 'evidence'), 'utf8'), 'local evidence');
  const merge =
    "require('node:child_process').execFileSync('git', ['merge', '--ff-only', 'codex/task'])";
  const kept = run(merge, task, true);
  assert.equal(await kept.done, 0, kept.output());
  assert.equal(await fs.readFile(path.join(task, 'evidence'), 'utf8'), 'local evidence');
  const final = run(merge);
  assert.equal(await final.done, 0, final.output());
  assert.equal(
    await fs.stat(task).then(
      () => true,
      () => false,
    ),
    false,
  );
  const [name] = await fs.readdir(path.join(root, 'archives'));
  const archived = path.join(root, 'archives', name!, 'checkout');
  assert.equal(await fs.readFile(path.join(archived, 'evidence'), 'utf8'), 'local evidence');
  assert.equal(
    await fs.stat(path.join(archived, 'node_modules')).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(await fs.readFile(path.join(peer, 'unfinished'), 'utf8'), 'peer work');
  assert.equal(git(['rev-parse', 'main']), git(['rev-parse', 'codex/task']));
});

test('cleanup refuses dirty or locked task even after a successful integration command', async (t) => {
  const { main, task, git, run } = await fixture(t);
  git(['branch', '-m', 'codex/task'], task);
  await fs.writeFile(path.join(task, 'unfinished'), 'keep me');
  const dirty = run('process.exit(0)');
  assert.equal(await dirty.done, 1);
  assert.equal(await fs.readFile(path.join(task, 'unfinished'), 'utf8'), 'keep me');
  await fs.unlink(path.join(task, 'unfinished'));
  git(['worktree', 'lock', task], main);
  const locked = run('process.exit(0)');
  assert.equal(await locked.done, 1);
  assert.match(locked.output(), /locked/);
  assert.equal(git(['branch', '--show-current'], task).trim(), 'codex/task');
});
