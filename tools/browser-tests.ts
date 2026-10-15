import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceEnvironment } from './assets/workspace';
import { acquireCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { openPreview } from './preview-session';
// Explicit diagnostics stay opt-in; every other suite must belong to a CI tier.
export function ciDevelopmentFiles(files: readonly string[], authoring: boolean) {
  return files
    .filter((file) => {
      if (/^(authored-ground|ground-review|orchard-design|orchard-polish)\.spec\.ts$/.test(file))
        return false;
      if (/^game(?:-[a-z-]+)?\.spec\.ts$/.test(file)) return false;
      if (/^(editor(?:-[a-z-]+)?|effects)\.spec\.ts$/.test(file)) return authoring;
      if (/^(scene(?:-[a-z-]+)?|audio|image-delivery|ground-occlusion)\.spec\.ts$/.test(file))
        return true;
      throw new Error('Browser suite has no CI tier: ' + file);
    })
    .sort();
}
export function browserSelection(args: string[]) {
  const built = args.includes('--built');
  const forwarded = args.filter((arg) => arg !== '--built');
  const selections = forwarded.filter((arg) => !arg.startsWith('--'));
  if (built && (!selections.length || selections.some((arg) => !/^game(\.spec\.ts)?$/.test(arg))))
    throw new Error(
      'Built browser tests require the Game scenario; scene/editor/effects use development previews',
    );
  const scope =
    selections.length && selections.every((arg) => /^game(\.spec\.ts)?$/.test(arg))
      ? 'runtime'
      : 'authoring';
  return { built, forwarded, scope } as const;
}
async function browserTests(args: string[]) {
  if (args.includes('--ci-development')) {
    if (args.includes('--built') || args.some((arg) => !arg.startsWith('--')))
      throw new Error('Use --ci-development [--authoring] without scenario selectors or --built');
    const files = (await fs.readdir(path.join(projectRoot, 'tests/browser'))).filter((file) =>
      file.endsWith('.spec.ts'),
    );
    const selected = ciDevelopmentFiles(files, args.includes('--authoring'));
    args = [
      ...selected,
      ...args.filter((arg) => !['--ci-development', '--authoring'].includes(arg)),
    ];
  } else if (args.includes('--authoring')) throw new Error('Use --authoring with --ci-development');
  const mode = process.env.CI === 'true' ? 'pinned' : 'local';
  const { built, forwarded, scope } = browserSelection(args);
  const lane = await acquireCommandLane({ command: 'test:browser' });
  try {
    const session = await openPreview({
      output: built ? 'built' : 'development',
      assets: mode,
      scope,
      port: Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
      reuse: !built && !process.env.CI,
      demand: true,
    });
    const workspace = session.workspace;
    try {
      await runProcess(
        process.execPath,
        ['--import', 'tsx', 'node_modules/@playwright/test/cli.js', 'test', ...forwarded],
        {
          cwd: projectRoot,
          env: {
            ...(workspace ? workspaceEnvironment(workspace) : process.env),
            LANTERN_ASSET_SHA256: session.assetIdentity,
            LANTERN_MANAGED_PREVIEW: '1',
            LANTERN_TEST_BUILT: String(built),
            LANTERN_TEST_ASSETS: mode,
            LANTERN_TEST_SCOPE: scope,
            LANTERN_TEST_TARGET: 'browser',
          },
          timeoutMs: args.includes('--ui') ? undefined : 30 * 60_000,
        },
      );
    } finally {
      await session.close();
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
