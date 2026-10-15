import { onAsyncExit } from './scope-exit';
import { openWorkspace, workspaceEnvironment, workspaceIdentity } from './assets/workspace';
import { runProcess } from './run-process';
import { cacheRoot, projectRoot } from './assets/paths';
const started = performance.now();
const args = process.argv.slice(2);
const scenario = args[0] && !args[0].startsWith('--') ? args.shift()! : 'walking';
const flags = args;
const native = new Set([
  'game',
  'sandbox',
  'animation',
  'hero',
  'lighting',
  'effects',
  'preferences',
  'scenes',
  'scene',
  'quality',
]);
if (scenario === 'record' || scenario === 'replay' || scenario === 'compare') {
  await runProcess(
    process.execPath,
    [
      '--import',
      'tsx',
      scenario === 'compare'
        ? 'tools/diagnostics/benchmark.ts'
        : 'tools/diagnostics/session-replay.ts',
      ...(scenario === 'compare' ? flags : [scenario, ...flags]),
    ],
    { cwd: projectRoot, timeoutMs: 10 * 60_000 },
  );
} else if (scenario === 'editor') {
  await runProcess(
    process.execPath,
    ['--import', 'tsx', 'tools/browser-tests.ts', 'editor', ...flags],
    { cwd: projectRoot, timeoutMs: 10 * 60_000 },
  );
} else if (scenario === 'startup') {
  await runProcess(
    process.execPath,
    ['--import', 'tsx', 'tools/diagnostics/startup-benchmark.ts', ...flags],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        LANTERN_ASSET_SHA256: await workspaceIdentity(
          flags.includes('--local') ? 'local' : 'pinned',
        ),
        LANTERN_CACHE_ROOT: cacheRoot() + '-measurements',
        LANTERN_CACHE_BUDGET_GIB: '0.25',
      },
      timeoutMs: 30 * 60_000,
    },
  );
} else if (scenario === 'walking') {
  try {
    // The executable contains its assets. Read the pin without acquiring payloads.
    const assets = await workspaceIdentity(flags.includes('--local') ? 'local' : 'pinned');
    await runProcess(
      process.execPath,
      [
        '--import',
        'tsx',
        'tools/diagnostics/walking-benchmark.ts',
        ...flags.filter((flag) => flag !== '--local'),
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LANTERN_ASSET_SHA256: assets,
          // Result/profile reservations must not rescan the artwork cache each run.
          LANTERN_CACHE_ROOT: cacheRoot() + '-measurements',
          LANTERN_CACHE_BUDGET_GIB: '0.25',
        },
        timeoutMs: Math.max(
          1,
          (flags.includes('--visible') ? 60000 : 27000) - (performance.now() - started),
        ),
        shutdownGraceMs: 1000,
      },
    );
  } catch (error) {
    console.error(
      `Walking measurement did not complete: ${error instanceof Error ? error.message : String(error)}. Retry with a matching package and a free GPU lane.`,
    );
    process.exitCode = 1;
  } finally {
    console.log(
      `Walking command wall time: ${((performance.now() - started) / 1000).toFixed(2)}s (includes pin lookup, launch and cleanup; packaging is separate).`,
    );
  }
} else if (native.has(scenario)) {
  const workspace = await openWorkspace(
    flags.includes('--local') ? 'local' : 'pinned',
    ['game', 'preferences'].includes(scenario) ? 'runtime' : 'authoring',
  );
  await using _cleanup1 = onAsyncExit(() => workspace.release());
  await runProcess(
    process.execPath,
    [
      '--import',
      'tsx',
      'tools/diagnostics/run-diagnostic.ts',
      scenario,
      ...flags.filter((flag) => flag !== '--local'),
    ],
    {
      cwd: projectRoot,
      env: workspaceEnvironment(workspace),
      timeoutMs: 10 * 60_000,
    },
  );
} else throw new Error('Unknown diagnostic: ' + scenario);
