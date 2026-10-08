import { run } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AssetCache } from './assets/cache';
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
      'application',
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
      'scene-preview',
      'source-recovery',
      'task-runner',
      'tooling',
      'validation-plan',
      'source-identity',
    ].map((name) => [`tests/${name}.test.ts`, 'pure']),
  );
export function testGroups(files: string[]) {
  return {
    pure: files.filter((f) => suiteRequirements[f] === 'pure'),
    assets: files.filter((f) => suiteRequirements[f] !== 'pure'),
  };
}
export async function runTests(
  files: string[],
  setup: () => Promise<NodeJS.ProcessEnv>,
  output?: (chunk: Buffer) => void,
) {
  const scope = `${files.length} suite${files.length === 1 ? '' : 's'}`,
    lane = await acquireTestLane();
  const report = (message: string) =>
    output ? output(Buffer.from(message + '\n')) : console.log(message);
  try {
    const groups = testGroups(files),
      identityOptions = { ignoreAssetPin: groups.assets.length === 0 };
    const before = await verificationIdentity(process.cwd(), identityOptions);
    report(`Running ${scope}: ${files.join(', ')}`);
    let passed = 0,
      failed = 0,
      details = '';
    const deadline = Date.now() + 5 * 60 * 1000;
    for (const [kind, selected] of Object.entries(groups)) {
      if (!selected.length) continue;
      const env = kind === 'assets' ? await setup() : lane.env;
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-test-result-')),
        resultFile = path.join(temporary, 'result.json');
      try {
        await runProcess(
          process.execPath,
          ['--import', 'tsx', path.resolve('tools/test.ts'), ...selected],
          {
            cwd: process.cwd(),
            env: { ...env, LANTERN_TEST_CHILD_RESULT: resultFile },
            timeoutMs: Math.max(1, deadline - Date.now()),
            output: (chunk) => {
              details = (details + chunk.toString()).slice(-1024 * 1024);
            },
          },
        );
        const result = JSON.parse(await fs.readFile(resultFile, 'utf8')) as SuiteResult;
        if (
          !Number.isSafeInteger(result.passed) ||
          result.passed < 0 ||
          !Number.isSafeInteger(result.failed) ||
          result.failed < 0
        )
          throw new Error('Invalid test worker result');
        passed += result.passed;
        failed += result.failed;
        details = (details + result.details).slice(-1024 * 1024);
        for (const message of result.messages) report(message);
      } catch (error) {
        report(details.slice(-4000));
        throw error;
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    }
    await requireStableInputs(process.cwd(), before, identityOptions);
    report(`${scope}; ${passed} checks passed; ${failed} failed.`);
    if (failed) {
      const cache = new AssetCache(),
        held = await cache.lease('diagnostics-' + randomUUID(), 2 * 1024 * 1024);
      try {
        await fs.writeFile(path.join(held.root, 'tests.log'), details.slice(-1024 * 1024));
        report('Failure diagnostics: ' + path.join(held.root, 'tests.log'));
      } finally {
        await held.release();
      }
      throw new Error('Tests failed');
    }
  } finally {
    await lane.release();
  }
}
type SuiteResult = { passed: number; failed: number; details: string; messages: string[] };
async function runSuites(files: string[]): Promise<SuiteResult> {
  const result: SuiteResult = { passed: 0, failed: 0, details: '', messages: [] };
  for await (const event of run({
    files,
    execArgv: ['--import', 'tsx'],
    concurrency: Math.min(2, availableParallelism()),
    timeout: 120000,
    signal: AbortSignal.timeout(5 * 60 * 1000),
  })) {
    if (event.type === 'test:pass') result.passed++;
    if (event.type === 'test:fail') {
      result.failed++;
      const message = inspect(event.data.details.error, {
        depth: 4,
        maxArrayLength: 20,
        maxStringLength: 2000,
      });
      if (result.failed <= 5) result.messages.push(`${event.data.name}: ${message.slice(0, 3000)}`);
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
    const files = await selectTestFiles(process.argv.slice(2)),
      lane = await acquireTestLane();
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
