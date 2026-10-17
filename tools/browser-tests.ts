import { runCli } from './cli';
import { onAsyncExit } from './scope-exit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { workspaceEnvironment } from './assets/workspace';
import { acquireCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
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
  const selections: string[] = [];
  // Scenario selectors precede Playwright options. Values such as --grep's
  // expression must not change the selected asset scope or built-Game admission.
  for (const arg of forwarded) {
    if (arg === '--ui' || arg === '--list') continue;
    if (arg.startsWith('-')) break;
    selections.push(arg);
  }
  const gameOnly =
    selections.length > 0 &&
    selections.every((arg) => /^(?:tests\/browser\/)?game(?:-[a-z-]+)?(?:\.spec\.ts)?$/.test(arg));
  if (built && !gameOnly)
    throw new Error(
      'Built browser tests require the Game scenario; scene/editor/effects use development previews',
    );
  const scope = gameOnly ? 'runtime' : 'authoring';
  // Playwright matches filters against absolute paths. A checkout named after
  // a scenario must not select unrelated suites or exceed the chosen asset scope.
  let scenarios = true;
  const filters = forwarded.map((arg) => {
    // Leave Playwright options and their values untouched. Scenario selectors
    // precede passthrough options; the wrapper's boolean flags need no value.
    if (arg.startsWith('-') && arg !== '--ui' && arg !== '--list') scenarios = false;
    return scenarios && /^[a-z][a-z-]*(?:\.spec\.ts)?$/.test(arg) ? 'tests/browser/' + arg : arg;
  });
  return { built, forwarded: filters, scope } as const;
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
  // Discovery does not execute fixtures, render, or consume prepared artwork.
  if (forwarded.includes('--list')) {
    await runProcess(
      process.execPath,
      ['--import', 'tsx', 'node_modules/@playwright/test/cli.js', 'test', ...forwarded],
      {
        cwd: projectRoot,
        env: { ...process.env, LANTERN_TEST_TARGET: 'browser', LANTERN_TEST_BUILT: String(built) },
        timeoutMs: 60_000,
      },
    );
    return;
  }
  const lane = await acquireCommandLane({ command: 'test:browser' });
  await using _cleanup2 = onAsyncExit(() => lane.release());
  const { openPreview } = await import('./preview-session');
  const session = await openPreview({
    output: built ? 'built' : 'development',
    assets: mode,
    scope,
    port: Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
    reuse: !built && !process.env.CI,
    demand: true,
  });
  const workspace = session.workspace;
  await using _cleanup1 = onAsyncExit(() => session.close());
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
}
runCli(import.meta.url, (args) => browserTests(args));
