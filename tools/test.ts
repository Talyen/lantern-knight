import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { openWorkspace, workspaceEnvironment } from './assets/workspace';

// These integration proofs launch multiple CLIs and hash repository inputs; keep them off the edit loop.
export const ciDefaultSuites: Readonly<Record<string, string>> = {
  'tests/unit/process-integration.test.ts': 'Fresh CLI replay, build proof and diagnostic launch',
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
    watch = args.includes('--watch');
  const requested = args.filter((arg) => arg !== '--assets' && arg !== '--watch');
  const files = await selectTestFiles(requested, projectRoot, assets ? 'assets' : 'unit');
  const workspace = assets ? await openWorkspace('pinned', 'authoring') : undefined;
  try {
    await runProcess(
      process.execPath,
      [
        '--import',
        'tsx',
        '--test',
        '--test-concurrency=2',
        ...(watch ? ['--watch'] : []),
        ...files,
      ],
      {
        cwd: projectRoot,
        env: workspace ? workspaceEnvironment(workspace) : process.env,
        timeoutMs: watch ? undefined : 5 * 60_000,
      },
    );
  } finally {
    await workspace?.release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
