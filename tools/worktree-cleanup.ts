import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Stage the checkout for rollback if unregistration fails. Successful cleanup
// deletes the complete checkout, including local-only files, and retains its branch.
export function removeIntegratedWorktree(main: string, task: string, branch: string, head: string) {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: main, encoding: 'utf8' }).trim();
  if (task === main || fs.lstatSync(task).isSymbolicLink())
    throw new Error('Unexpected task checkout');
  const records = git('worktree', 'list', '--porcelain', '-z').split('\0\0');
  const record = records.find((entry) => entry.split('\0').includes('worktree ' + task));
  if (
    !record?.split('\0').includes('branch refs/heads/' + branch) ||
    record.split('\0').some((field) => /^(locked|prunable)( |$)/.test(field))
  )
    throw new Error('Task worktree registration changed or is locked');
  if (
    git('-C', task, 'branch', '--show-current') !== branch ||
    git('-C', task, 'rev-parse', 'HEAD') !== head ||
    git('rev-parse', 'main') !== head
  )
    throw new Error('Task or main changed after integration');
  if (git('-C', task, 'status', '--porcelain', '--untracked-files=all'))
    throw new Error('Unfinished work preserved');
  for (const state of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'BISECT_START',
    'rebase-merge',
    'rebase-apply',
  ])
    if (fs.existsSync(git('-C', task, 'rev-parse', '--path-format=absolute', '--git-path', state)))
      throw new Error('Unfinished Git operation preserved');
  if (/^160000 /m.test(git('-C', task, 'ls-files', '--stage')))
    throw new Error('Submodule worktree preserved');
  const root = path.resolve(
    process.env.CODEX_WORKTREE_ARCHIVE_ROOT ??
      path.join(os.homedir(), '.codex', 'worktree-archives', path.basename(main)),
  );
  if (
    [main, task, git('rev-parse', '--path-format=absolute', '--git-common-dir')].some(
      (parent) => root === parent || root.startsWith(parent + path.sep),
    )
  )
    throw new Error('Recovery directory must be outside the repository and task checkout');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const recovery = fs.mkdtempSync(path.join(root, branch.replaceAll('/', '-') + '-'));
  const checkout = path.join(recovery, 'checkout');
  fs.writeFileSync(
    path.join(recovery, 'recovery.json'),
    JSON.stringify({ main, task, branch, head }, null, 2),
  );
  process.chdir(main);
  fs.renameSync(task, checkout);
  try {
    git('worktree', 'remove', task); // Missing original path: unregister only this entry, without --force.
  } catch (error) {
    if (!fs.existsSync(task)) fs.renameSync(checkout, task);
    throw error;
  }
  fs.unlinkSync(path.join(checkout, '.git'));
  fs.rmSync(recovery, { recursive: true });
  console.log(
    'Removed completed worktree ' +
      task +
      ', including local-only files; retained branch ' +
      branch,
  );
}
