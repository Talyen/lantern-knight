import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkspace, workspaceEnvironment } from './assets/workspace';
import { acquireCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { buildIdentity } from './build-identity';
export function browserSelection(args: string[]) {
  const built = args.includes('--built');
  const forwarded = args.filter((arg) => arg !== '--built');
  const selections = forwarded.filter((arg) => !arg.startsWith('--'));
  if (built && (!selections.length || selections.some((arg) => !/^game(\.spec\.ts)?$/.test(arg))))
    throw new Error(
      'Built browser tests require the Game scenario; scene/editor/effects use development previews',
    );
  const scope =
    selections.length && selections.every((arg) => /^(game|scene)(\.spec\.ts)?$/.test(arg))
      ? 'runtime'
      : 'authoring';
  return { built, forwarded, scope } as const;
}
async function browserTests(args: string[]) {
  const mode = process.env.CI === 'true' ? 'pinned' : 'local';
  const { built, forwarded, scope } = browserSelection(args);
  const lane = await acquireCommandLane({ command: 'test:browser' });
  try {
    const artifact = built ? await buildIdentity({ target: 'web' }) : undefined;
    const workspace = built ? undefined : await openWorkspace(mode, scope);
    try {
      await runProcess(
        process.execPath,
        ['--import', 'tsx', 'node_modules/@playwright/test/cli.js', 'test', ...forwarded],
        {
          cwd: projectRoot,
          env: {
            ...(workspace ? workspaceEnvironment(workspace) : process.env),
            ...(artifact ? { LANTERN_ASSET_SHA256: artifact.assets.sha256 } : {}),
            LANTERN_TEST_BUILT: String(built),
            LANTERN_TEST_ASSETS: mode,
            LANTERN_TEST_SCOPE: scope,
            LANTERN_TEST_TARGET: 'browser',
          },
          timeoutMs: args.includes('--ui') ? undefined : 10 * 60_000,
        },
      );
    } finally {
      await workspace?.release();
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
