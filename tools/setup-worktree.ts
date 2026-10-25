import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// Runs before dependency installation using Node's native TypeScript support.
export function setupWorktree(root: string, authoring = false) {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 }).trim();
  const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  const own = git('rev-parse', '--path-format=absolute', '--git-dir');
  if (common === own) return 'Primary checkout retained';
  if (authoring) {
    // Check headroom before restoring masters. Unique or changed files stay owned
    // by Git; sparse-checkout never forces over them.
    const bytes = git('ls-tree', '-r', '-l', 'HEAD', 'asset-data/sources')
      .split('\n')
      .filter(Boolean)
      .reduce((sum, line) => {
        const [metadata, name] = line.split('\t');
        return (
          sum +
          (fs.existsSync(path.join(root, name!)) ? 0 : Number(metadata!.trim().split(/\s+/)[3]))
        );
      }, 0);
    const space = fs.statfsSync(root);
    if (bytes > space.bavail * space.bsize)
      throw new Error('Insufficient disk headroom to restore authoring masters');
    git('sparse-checkout', 'disable');
    return 'Authoring masters restored';
  }
  if (
    git('status', '--porcelain', '--untracked-files=all', '--', 'asset-data/sources') ||
    git('ls-files', '--others', '--ignored', '--exclude-standard', '--', 'asset-data/sources')
  )
    return 'Source edits preserved; checkout scope retained';
  let configured = false;
  try {
    configured = git('config', '--get', 'core.sparseCheckout') === 'true';
  } catch {
    /* Full checkout. */
  }
  if (configured) return 'Existing sparse scope retained';
  git('sparse-checkout', 'set', '--no-cone', '/*', '!/asset-data/sources/');
  return 'Code-only worktree: prepared objects retained; source masters omitted';
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--authoring'))
    throw new Error('Use worktree:setup [--authoring]');
  console.log(
    setupWorktree(
      fileURLToPath(new URL('../', import.meta.url)),
      args.includes('--authoring') || process.env.LANTERN_AUTHORING_WORKTREE === '1',
    ),
  );
}
