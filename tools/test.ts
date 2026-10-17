import { runCli } from './cli';
import { onAsyncExit } from './scope-exit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { openWorkspace, workspaceEnvironment } from './assets/workspace';

// These proofs launch CLIs or wait through real contention; keep them off the edit loop.
export const ciDefaultSuites: Readonly<Record<string, string>> = {
  'tests/unit/process-integration.test.ts': 'Fresh CLI replay, build proof and diagnostic launch',
  'tests/unit/integration-lock.test.ts':
    'Real Git worktrees and multiple integration CLI processes',
  'tests/unit/asset-cache-contention.test.ts':
    'Real cache mutex contention beyond the former ten-second timeout',
};

export async function selectTestFiles(args: string[], root = projectRoot, group = 'unit') {
  const directory = path.join(root, 'tests', group);
  const available = (await fs.readdir(directory))
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => 'tests/' + group + '/' + name)
    .sort();
  if (!available.length) throw new Error('No test suites found');
  if (group === 'unit')
    for (const name of Object.keys(ciDefaultSuites))
      if (!available.includes(name)) throw new Error('Missing CI-default test suite: ' + name);
  const full = args.includes('--full');
  if (full && (group !== 'unit' || args.length !== 1))
    throw new Error('Use --full for all pure suites, without exact files or --assets');
  if (full) return available;
  if (!args.length) {
    const selected =
      group === 'unit' ? available.filter((name) => !(name in ciDefaultSuites)) : available;
    if (!selected.length) throw new Error('No local test suites found; use --full');
    return selected;
  }
  return [
    ...new Set(
      args.map((arg) => {
        const name = path.relative(root, path.resolve(root, arg)).split(path.sep).join('/');
        if (!available.includes(name)) throw new Error('Invalid test selection: ' + arg);
        return name;
      }),
    ),
  ];
}
async function main() {
  const args = process.argv.slice(2);
  const assets = args.includes('--assets'),
    watch = args.includes('--watch'),
    verbose = args.includes('--verbose');
  const requested = args.filter((arg) => !['--assets', '--watch', '--verbose'].includes(arg));
  const files = await selectTestFiles(requested, projectRoot, assets ? 'assets' : 'unit');
  const workspace = assets ? await openWorkspace('pinned', 'authoring') : undefined;
  await using _scopeExit1 = onAsyncExit(async () => {
    await workspace?.release();
  });
  await runProcess(
    process.execPath,
    [
      '--import',
      'tsx',
      '--test',
      // Routine suites run serially in one runtime; full/asset/watch tiers keep
      // process isolation for integration proofs and independently reloadable files.
      ...(watch || assets || requested.includes('--full')
        ? ['--test-concurrency=2']
        : ['--test-isolation=none']),
      '--test-reporter=' + (watch || verbose ? 'spec' : './tools/test-reporter.ts'),
      ...(watch ? ['--watch'] : []),
      ...files,
    ],
    {
      cwd: projectRoot,
      env: workspace ? workspaceEnvironment(workspace) : process.env,
      timeoutMs: watch ? undefined : 5 * 60_000,
    },
  );
}
runCli(import.meta.url, () => main());
