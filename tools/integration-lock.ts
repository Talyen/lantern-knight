import { onAsyncExit } from './scope-exit';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { acquireCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { removeIntegratedWorktree } from './worktree-cleanup';
import { checkpointSceneSaves } from './scene/checkpoint-scene-saves';

const exec = promisify(execFile);

export async function withIntegrationLock(
  command: string,
  args: string[],
  cwd = process.cwd(),
  keepWorktree = false,
) {
  if (process.env.LANTERN_INTEGRATION_LOCK)
    throw new Error(
      'Nested integration locks are unsupported; keep all integration steps in one command',
    );
  const git = async (...args: string[]) =>
    (await exec('git', args, { cwd, encoding: 'utf8' })).stdout;
  const common = await realpath(
    (await git('rev-parse', '--path-format=absolute', '--git-common-dir')).trim(),
  );
  const port = 49152 + (createHash('sha256').update(common).digest().readUInt16BE(0) % 16384);
  const lane = await acquireCommandLane({
    port,
    name: 'main integration',
    command: [command, ...args].join(' '),
    cwd,
    waitMs: 30 * 60_000,
  });
  await using _cleanup1 = onAsyncExit(() => lane.release());
  // Discover main after admission: its checkout may have changed while waiting.
  const entry = (await git('worktree', 'list', '--porcelain', '-z'))
    .split('\0\0')
    .find((entry) => entry.split('\0').includes('branch refs/heads/main'));
  const main = entry
    ?.split('\0')
    .find((field) => field.startsWith('worktree '))
    ?.slice(9);
  if (!main) throw new Error('Local main must be checked out in a worktree; no work started');
  await checkpointSceneSaves(main);
  const task = (await git('rev-parse', '--show-toplevel')).trim();
  const branch = (await git('branch', '--show-current')).trim();
  console.log(`Integration lock acquired; running in ${main}`);
  await runProcess(command, args, {
    cwd: main,
    env: { ...process.env, LANTERN_INTEGRATION_LOCK: common },
  });
  if (!keepWorktree && task !== main && branch.startsWith('codex/')) {
    try {
      const head = (await git('rev-parse', 'HEAD')).trim();
      removeIntegratedWorktree(main, task, branch, head);
    } catch (error) {
      throw new Error(`Integration command completed; worktree cleanup blocked: ${String(error)}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = process.argv.slice(2);
  const keepWorktree = options[0] === '--keep-worktree';
  if (keepWorktree) options.shift();
  const [command, ...args] = options;
  if (!command || command === '--help') {
    console.log('Use npm run integration:lock -- [--keep-worktree] <command> [args...]');
    console.log(
      'Runs the complete integration command in local main under a shared worktree lock.',
    );
    if (!command) process.exitCode = 1;
  } else {
    withIntegrationLock(command, args, process.cwd(), keepWorktree).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
