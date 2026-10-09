import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace, workspaceEnvironment } from './assets/workspace';
import { acquireCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
async function browserTests(args: string[]) {
  const mode = process.env.CI === 'true' ? 'pinned' : 'local';
  const selections = args.filter((arg) => !arg.startsWith('--'));
  const scope =
    selections.length && selections.every((arg) => /^(game|scene)(\.spec\.ts)?$/.test(arg))
      ? 'runtime'
      : 'authoring';
  const lane = await acquireCommandLane({ command: 'test:browser' });
  try {
    const workspace = await openWorkspace(mode, scope);
    try {
      await runProcess(
        process.execPath,
        ['--import', 'tsx', 'node_modules/@playwright/test/cli.js', 'test', ...args],
        {
          cwd: projectRoot,
          env: {
            ...workspaceEnvironment(workspace),
            LANTERN_TEST_ASSETS: mode,
            LANTERN_TEST_SCOPE: scope,
            LANTERN_TEST_TARGET: 'browser',
          },
          timeoutMs: args.includes('--ui') ? undefined : 10 * 60_000,
        },
      );
    } finally {
      await workspace.release();
    }
  } finally {
    await lane.release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  browserTests(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
