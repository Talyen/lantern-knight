import { runCli } from './cli';
import { onAsyncExit } from './scope-exit';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { constants } from 'node:fs';
import assert from 'node:assert/strict';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { openWorkspace, workspaceEnvironment } from './assets/workspace';
import { verifyBuildIdentity } from './build-identity';

// Current Game compatibility and source-preservation proofs consume the same
// artifact as player/native checks. Legacy artwork sweeps remain test:assets.
const builtAssetSuites = [
  'animation-treatment',
  'hero-art',
  'oracle-art',
  'library-import',
  'source-recovery',
].map((name) => `tests/assets/${name}.test.ts`);
async function builtAssetWorkspace() {
  const artifact = await verifyBuildIdentity({ target: 'web' });
  const pin = await openWorkspace('pinned', 'authoring', true);
  let root: string | undefined;
  let admitted = false;
  await using cleanup = onAsyncExit(async () => {
    if (!admitted) {
      try {
        if (root) await fs.rm(root, { recursive: true, force: true });
      } finally {
        await pin.release();
      }
    }
  });
  assert.equal(artifact.assets.sha256, pin.identity, 'Built asset pin differs');
  assert.equal(artifact.assets.recipeSha256, pin.recipe, 'Built asset recipe differs');
  await pin.ensureMetadataFile?.('ink/hero-receipt.json');
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-built-assets-'));
  const directory = root;
  // Independent files prevent fixture edits from mutating the delivered artifact.
  await fs.cp(path.join(projectRoot, 'dist'), path.join(root, 'public'), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
  await fs.mkdir(path.join(root, 'metadata/ink'), { recursive: true });
  await fs.copyFile(
    path.join(pin.metadataDirectory, 'ink/hero-receipt.json'),
    path.join(root, 'metadata/ink/hero-receipt.json'),
  );
  admitted = true;
  return {
    ...pin,
    root,
    publicDirectory: path.join(root, 'public'),
    metadataDirectory: path.join(root, 'metadata'),
    ensurePublicFile: undefined,
    ensureMetadataFile: undefined,
    async release() {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } finally {
        await pin.release();
      }
    },
  };
}

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
    built = args.includes('--built'),
    watch = args.includes('--watch'),
    verbose = args.includes('--verbose');
  const requested = args.filter(
    (arg) => !['--assets', '--built', '--watch', '--verbose'].includes(arg),
  );
  if (built && (!assets || requested.length || watch))
    throw new Error('Use test:assets -- --built without selectors or --watch');
  const files = await selectTestFiles(
    built ? builtAssetSuites : requested,
    projectRoot,
    assets ? 'assets' : 'unit',
  );
  const workspace = built
    ? await builtAssetWorkspace()
    : assets
      ? await openWorkspace('pinned', 'authoring')
      : undefined;
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
      // Full-library asset proofs re-open and verify payloads after acquisition.
      timeoutMs: watch ? undefined : (assets ? 10 : 5) * 60_000,
    },
  );
}
runCli(import.meta.url, () => main());
