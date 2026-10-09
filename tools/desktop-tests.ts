import { runProcess } from './run-process';
import { acquireCommandLane } from './command-lane';
import { projectRoot } from './assets/paths';
const lane = await acquireCommandLane({ command: 'test:desktop' });
try {
  await runProcess(
    process.execPath,
    ['--import', 'tsx', 'node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
    {
      cwd: projectRoot,
      env: { ...process.env, LANTERN_TEST_TARGET: 'desktop' },
      timeoutMs: 10 * 60_000,
    },
  );
} finally {
  await lane.release();
}
