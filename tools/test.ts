import { run } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import os, { availableParallelism } from 'node:os';
import { runProcess } from './run-process';
import { acquireTestLane, verificationIdentity, requireStableInputs } from './verification';

export async function selectTestFiles(args: string[], root = process.cwd()) {
  const available = (await fs.readdir(path.join(root, 'tests'), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => 'tests/' + entry.name)
    .sort();
  if (!available.length) throw new Error('No test suites found.');
  if (!args.length) return available;
  const selected = args.map((arg) => {
    const relative = path.relative(root, path.resolve(root, arg)).split(path.sep).join('/');
    if (!available.includes(relative))
      throw new Error(
        `Invalid test selection: ${arg}. Supply an existing tests/<name>.test.ts file.`,
      );
    return relative;
  });
  return [...new Set(selected)];
}

// Unknown suites require artwork until their independence has been established.
export const suiteRequirements: Readonly<Record<string, 'pure' | 'runtime-assets'>> =
  Object.fromEntries(
    [
      'build-assets',
      'code-tools',
      'agent-context',
      'compiler',
      'animation-sampling',
      'churchyard',
      'lighting',
      'application',
      'systems',
      'foundation',
      'asset-finalization',
      'asset-packs',
      'bitmap',
      'command-lane',
      'effects-playground',
      'frame-scheduler',
      'hero-actions',
      'processes',
      'persistence',
      'scene-editor',
      'scene-design',
      'library-import',
      'scene-preview',
      'source-recovery',
      'task-runner',
      'tooling',
      'validation-plan',
      'source-identity',
      'worktrees',
      'verification-plan',
      'prototype-workflow',
    ].map((name) => [`tests/${name}.test.ts`, 'pure']),
  );
export function testGroups(files: string[]) {
  return {
    pure: files.filter((f) => suiteRequirements[f] === 'pure'),
    assets: files.filter((f) => suiteRequirements[f] !== 'pure'),
  };
}
export class TestExecutionFailure extends Error {
  constructor(
    public result: SuiteResult,
    cause: unknown,
  ) {
    super(String(cause));
  }
}
export async function runTests(
  files: string[],
  setup: () => Promise<NodeJS.ProcessEnv>,
  output?: (chunk: Buffer) => void,
  root = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<SuiteResult> {
  const groups = testGroups(files);
  const lane = groups.assets.length
    ? await acquireTestLane()
    : { env: { ...process.env }, release: async () => {} };
  const aggregate: SuiteResult = { passed: 0, failed: 0, details: '', messages: [], timings: [] };
  try {
    const identityOptions = {
      ignoreAssetPin: groups.assets.length === 0,
      ...(environment.LANTERN_VERIFICATION_FILES
        ? { files: JSON.parse(environment.LANTERN_VERIFICATION_FILES) as string[] }
        : {}),
    };
    const before = await verificationIdentity(root, identityOptions);
    const deadline = Date.now() + 5 * 60 * 1000;
    for (const [kind, selected] of Object.entries(groups)) {
      if (!selected.length) continue;
      // Workspace setup adds asset paths; keep the lane credentials acquired by
      // this runner so its worker cannot wait on its own parent for admission.
      const env = { ...lane.env, ...environment, ...(kind === 'assets' ? await setup() : {}) };
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-test-result-')),
        resultFile = path.join(temporary, 'result.json');
      try {
        const childEnv: NodeJS.ProcessEnv = { ...env, LANTERN_TEST_CHILD_RESULT: resultFile };
        delete childEnv.NODE_TEST_CONTEXT;
        await runProcess(
          process.execPath,
          [
            '--import',
            import.meta.resolve('tsx'),
            fileURLToPath(new URL('./test.ts', import.meta.url)),
            ...selected,
          ],
          {
            cwd: root,
            env: childEnv,
            timeoutMs: Math.max(1, deadline - Date.now()),
            output: (chunk) => {
              aggregate.details = (aggregate.details + chunk.toString()).slice(-1024 * 1024);
              // Callers decide whether raw output belongs in a diagnostic or the terminal.
              output?.(chunk);
            },
          },
        );
        const result = JSON.parse(await fs.readFile(resultFile, 'utf8')) as SuiteResult;
        if (
          !Number.isSafeInteger(result.passed) ||
          result.passed < 0 ||
          !Number.isSafeInteger(result.failed) ||
          result.failed < 0 ||
          !Array.isArray(result.timings) ||
          !Array.isArray(result.messages) ||
          typeof result.details !== 'string'
        )
          throw new Error('Invalid test worker result');
        if (result.passed + result.failed === 0) throw new Error('Test worker executed no checks');
        aggregate.passed += result.passed;
        aggregate.failed += result.failed;
        aggregate.details = (aggregate.details + result.details).slice(-1024 * 1024);
        aggregate.messages.push(
          ...result.messages.slice(0, Math.max(0, 3 - aggregate.messages.length)),
        );
        aggregate.timings.push(...result.timings);
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    await requireStableInputs(root, before, identityOptions);
    if (aggregate.failed) throw new Error('Tests failed');
    return aggregate;
  } catch (error) {
    throw new TestExecutionFailure(aggregate, error);
  } finally {
    await lane.release();
  }
}
export type SuiteResult = {
  passed: number;
  failed: number;
  details: string;
  messages: string[];
  timings: { file: string; ms: number }[];
};
async function runSuites(files: string[]): Promise<SuiteResult> {
  const result: SuiteResult = { passed: 0, failed: 0, details: '', messages: [], timings: [] };
  for await (const event of run({
    files,
    execArgv: ['--import', import.meta.resolve('tsx')],
    concurrency: Math.min(2, availableParallelism()),
    timeout: 120000,
    signal: AbortSignal.timeout(5 * 60 * 1000),
  })) {
    // Only a worker's test summary establishes executed checks. Node's parent
    // stream also reports empty files as passing containers without this summary.
    if (event.type === 'test:summary' && event.data.file) {
      result.passed += event.data.counts.passed;
      result.timings.push({ file: event.data.file, ms: Math.round(event.data.duration_ms) });
    }
    if (event.type === 'test:fail') {
      result.failed++;
      const message = inspect(event.data.details.error, {
        depth: 4,
        maxArrayLength: 20,
        maxStringLength: 2000,
      });
      if (result.messages.length < 3)
        result.messages.push(
          `${event.data.file}:${event.data.line}:${event.data.column} ${event.data.name}: ${message}`,
        );
      result.details = (result.details + event.data.name + '\n' + message + '\n').slice(
        -1024 * 1024,
      );
    }
    if (event.type === 'test:stderr' || event.type === 'test:stdout')
      result.details = (result.details + event.data.message).slice(-1024 * 1024);
  }
  return result;
}
async function main() {
  if (process.env.LANTERN_TEST_CHILD_RESULT) {
    const files = await selectTestFiles(process.argv.slice(2));
    const lane = testGroups(files).assets.length
      ? await acquireTestLane()
      : { release: async () => {} };
    try {
      await fs.writeFile(
        process.env.LANTERN_TEST_CHILD_RESULT,
        JSON.stringify(await runSuites(files)),
      );
    } finally {
      await lane.release();
    }
  } else await (await import('./task-runner')).managedTask('test', process.argv.slice(2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
