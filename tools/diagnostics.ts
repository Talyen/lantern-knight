import { openWorkspace, workspaceEnvironment } from './assets/workspace';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
const [scenario = 'game', ...flags] = process.argv.slice(2);
const native = new Set([
  'game',
  'sandbox',
  'animation',
  'hero',
  'lighting',
  'crypt',
  'graveyard',
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
      scenario === 'compare' ? 'tools/benchmark.ts' : 'tools/session-replay.ts',
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
} else if (native.has(scenario)) {
  const workspace = await openWorkspace(
    flags.includes('--local') ? 'local' : 'pinned',
    'authoring',
  );
  try {
    await runProcess(
      process.execPath,
      [
        '--import',
        'tsx',
        'tools/run-diagnostic.ts',
        scenario,
        ...flags.filter((flag) => flag !== '--local'),
      ],
      { cwd: projectRoot, env: workspaceEnvironment(workspace), timeoutMs: 10 * 60_000 },
    );
  } finally {
    await workspace.release();
  }
} else throw new Error('Unknown diagnostic: ' + scenario);
