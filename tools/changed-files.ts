import { execFileSync } from 'node:child_process';

// Include staged, unstaged and untracked inputs. --no-renames keeps both sides
// of a move visible to coverage selection.
export function changedFiles(root: string, base: string) {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 ** 2 })
      .split('\0')
      .filter(Boolean);
  const revision = git('rev-parse', '--verify', '--end-of-options', base + '^{commit}')[0]!.trim();
  return [
    ...new Set([
      ...git('diff', '--no-ext-diff', '--name-only', '--no-renames', '-z', revision),
      ...git('ls-files', '--others', '--exclude-standard', '-z'),
    ]),
  ].sort();
}

export function comparisonFiles(root: string, base?: string) {
  try {
    const revision =
      base ??
      execFileSync('git', ['merge-base', 'main', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    return changedFiles(root, revision);
  } catch {
    console.log('Comparison unavailable; selecting full source verification');
    return undefined;
  }
}
