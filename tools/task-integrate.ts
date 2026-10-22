import { execFileSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli';
import { withIntegrationLock } from './integration-lock';
import { runProcess } from './run-process';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function requireTask(task: string, branch: string) {
  if (!branch.startsWith('codex/') || git(task, 'branch', '--show-current') !== branch)
    throw new Error('Run task:integrate from the task branch in its isolated codex/ worktree');
  if (git(task, 'status', '--porcelain', '--untracked-files=all'))
    throw new Error('Commit reviewed task changes before integration');
}

async function integrate(main: string, task: string, branch: string) {
  const common = await realpath(
    git(main, 'rev-parse', '--path-format=absolute', '--git-common-dir'),
  );
  if (
    process.env.LANTERN_INTEGRATION_LOCK !== common ||
    main === task ||
    (await realpath(git(task, 'rev-parse', '--path-format=absolute', '--git-common-dir'))) !==
      common
  )
    throw new Error('Integration requires the shared repository lock and an isolated task');
  requireTask(task, branch);
  if (
    git(main, 'branch', '--show-current') !== 'main' ||
    git(main, 'status', '--porcelain', '--untracked-files=all')
  )
    throw new Error('Main changed after lock admission; preserved work, rerun integration');
  const before = git(main, 'rev-parse', 'HEAD');
  const base = git(task, 'merge-base', 'HEAD', before);
  await runProcess('git', ['merge', '--no-edit', before], { cwd: task });
  const verified = git(task, 'rev-parse', 'HEAD');
  // Both task changes and incoming main changes participate in selection.
  await runProcess(process.execPath, ['--import', 'tsx', 'tools/check.ts', '--base', base], {
    cwd: task,
  });
  requireTask(task, branch);
  if (
    git(task, 'rev-parse', 'HEAD') !== verified ||
    git(main, 'rev-parse', 'HEAD') !== before ||
    git(main, 'branch', '--show-current') !== 'main' ||
    git(main, 'status', '--porcelain', '--untracked-files=all')
  )
    throw new Error('Task or main changed during verification; preserved work, rerun integration');
  await runProcess('git', ['merge', '--ff-only', verified], { cwd: main });
  console.log(`Integrated ${verified} into local main at ${main}`);
}

runCli(import.meta.url, async () => {
  const args = process.argv.slice(2);
  if (args[0] === '--locked' && args.length === 3)
    return integrate(process.cwd(), args[1]!, args[2]!);
  if (args.some((arg) => arg !== '--keep-worktree') || args.length > 1)
    throw new Error('Use task:integrate [--keep-worktree]');
  const task = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const branch = git(task, 'branch', '--show-current');
  requireTask(task, branch);
  return withIntegrationLock(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      fileURLToPath(import.meta.url),
      '--locked',
      task,
      branch,
    ],
    task,
    args.includes('--keep-worktree'),
  );
});
