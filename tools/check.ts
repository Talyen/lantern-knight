import { runNpmTask } from './task-runner';
import { taskInputs, taskPlan, type Invocation } from './task-context';
import { projectRoot } from './assets/paths';
import { runProcess } from './run-process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificationIdentity, requireStableInputs } from './verification';
import { verificationPlan, type VerificationPlan } from './verification-plan';
import { snapshot, inputKey, phaseEvidence, recordCheck, type InputSnapshot } from './task-state';
import { dependencyInputs } from './verification-plan';
import { publishResult, failureLog, ReportedFailure, type CommandResult } from './command-report';

export async function runChecks(
  root: string,
  run: (name: string, args: string[], files?: string[]) => Promise<void | CommandResult>,
  local = false,
  full = false,
  providedInputs?: InputSnapshot,
  providedPlan?: VerificationPlan,
) {
  const inputs = providedInputs ?? (await snapshot(root));
  const before = await verificationIdentity(root, { inputs }),
    steps: {
      name: string;
      status: 'passed' | 'failed' | 'skipped';
      reason?: string;
      reused?: boolean;
      ms?: number;
    }[] = [];
  const plan = providedPlan ?? (await verificationPlan(root, { full, prototype: !full, inputs }));
  const changed = plan.changed;
  const code = changed.filter(
    (name) => /\.(?:[cm]?[jt]sx?|py|css|html)$/.test(name) && name in inputs.files,
  );
  const gates = new Set(
    full
      ? [
          'typecheck',
          'lint',
          'unused code',
          'repository',
          'architecture',
          'documentation',
          'formatting',
          'tests',
          'assets',
          'whitespace',
        ]
      : [
          ...(!changed.length ? [] : ['repository', 'whitespace']),
          ...(changed.some(
            (name) =>
              /\.[cm]?[jt]sx?$/.test(name) || /^(?:package|tsconfig|\.oxlintrc|knip)/.test(name),
          )
            ? ['typecheck', 'unused code']
            : []),
          ...(code.some((name) => /\.[cm]?[jt]sx?$|\.py$/.test(name)) ||
          changed.some((name) => /\.oxlintrc|ruff\.toml/.test(name))
            ? ['lint']
            : []),
          ...(code.length ? ['formatting'] : []),
          ...(changed.some((name) => name.startsWith('src/')) ? ['architecture'] : []),
          ...(changed.some(
            (name) =>
              /\.md$/.test(name) ||
              /package\.json|task-runner\.ts/.test(name) ||
              !(name in inputs.files),
          )
            ? ['documentation']
            : []),
          ...(plan.suites.length ? ['tests'] : []),
        ],
  );
  const commands: [string, string[]][] = [
    ['typecheck', ['run', 'typecheck']],
    ['lint', ['run', 'lint']],
    ['unused code', ['run', 'knip']],
    ['repository', ['run', 'repo:check']],
    ['architecture', ['run', 'architecture:check']],
    ['documentation', ['run', 'docs:check']],
    ['formatting', ['run', 'format:check']],
    [
      'tests',
      full
        ? ['run', 'test:full', ...(local ? ['--', '--local'] : [])]
        : ['test', '--', ...plan.suites, ...(local ? ['--local'] : [])],
    ],
    [
      full ? 'assets' : 'asset pin',
      ['run', full ? 'assets:check' : 'assets:pin:current', ...(local ? ['--', '--local'] : [])],
    ],
    ['whitespace', []],
  ];
  let failed = false;
  let tests: CommandResult | undefined;
  for (const [name, args] of commands) {
    if (failed) {
      steps.push({ name, status: 'skipped', reason: 'earlier check failed' });
      continue;
    }
    if (!gates.has(name)) {
      steps.push({
        name,
        status: 'skipped',
        reason: 'outside prototype task scope; full coverage belongs to integration/CI',
      });
      continue;
    }
    if (name === 'tests' && !plan.suites.length) {
      steps.push({ name, status: 'skipped', reason: 'no affected suites; no tests executed' });
      continue;
    }
    const started = performance.now();
    let reused = false;
    try {
      if (full) {
        const result = await run(name, args);
        if (name === 'tests' && result) tests = result;
      } else {
        const all = Object.keys(inputs.files);
        const names =
          name === 'tests'
            ? await dependencyInputs(root, plan.suites, inputs)
            : name === 'formatting' || name === 'lint'
              ? [
                  ...code,
                  'package.json',
                  'package-lock.json',
                  'ruff.toml',
                  '.prettierrc.json',
                  '.oxlintrc.json',
                  'tools/format.ts',
                  'tools/lint.ts',
                  'tools/code-tools.ts',
                ]
              : name === 'documentation'
                ? all.filter(
                    (file) =>
                      /\.md$/.test(file) || file === 'package.json' || file.startsWith('tools/'),
                  )
                : name === 'typecheck' || name === 'unused code' || name === 'architecture'
                  ? all.filter(
                      (file) =>
                        /^(?:src|electron|tools|tests|authoring|assets)\//.test(file) ||
                        /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config|\.oxlintrc|knip)/.test(
                          file,
                        ),
                    )
                  : all;
        const key = inputKey(
          inputs,
          names,
          'prototype-gate-v2:' +
            name +
            ':' +
            process.platform +
            ':' +
            process.version +
            ':' +
            JSON.stringify(args),
        );
        const proof = await phaseEvidence(root, name, key, async () => {
          const configChanged = changed.some((file) =>
            /\.oxlintrc|ruff\.toml|\.prettier/.test(file),
          );
          const result = await run(
            name,
            args,
            (name === 'lint' || name === 'formatting') && !configChanged ? code : undefined,
          );
          if (name === 'tests' && result) tests = result;
          if (
            inputKey(await snapshot(root), names, 'stability') !==
            inputKey(inputs, names, 'stability')
          )
            throw new Error('Inputs changed during ' + name);
          return { passed: true, ...(tests && name === 'tests' ? { tests } : {}) };
        });
        reused = proof.reused;
        if (name === 'tests' && proof.result.tests)
          tests = proof.reused
            ? {
                ...proof.result.tests,
                executed: 0,
                reused: proof.result.tests.executed + proof.result.tests.reused,
              }
            : proof.result.tests;
      }
      steps.push({ name, status: 'passed', reused, ms: Math.round(performance.now() - started) });
    } catch (error) {
      if (error instanceof ReportedFailure && name === 'tests') tests = error.result;
      steps.push({
        name,
        status: 'failed',
        reason: String(error),
        ms: Math.round(performance.now() - started),
      });
      failed = true;
    }
  }
  try {
    if (full) await requireStableInputs(root, before);
    else if (JSON.stringify(inputs.files) !== JSON.stringify((await snapshot(root)).files))
      throw new Error('Task inputs changed during verification');
    steps.push({ name: 'source stability', status: 'passed' });
  } catch (error) {
    steps.push({
      name: 'source stability',
      status: 'failed',
      reason: String(error),
    });
    failed = true;
  }
  if (!failed && !full) await recordCheck(root, inputs);
  return { source: before, plan, steps, tests, passed: !failed };
}
async function main() {
  await (await import('./task-runner')).managedTask('check', process.argv.slice(2));
}
export async function check(
  root: string,
  args: string[],
  execute: (
    name: string,
    args: string[],
    output: (chunk: Buffer) => void,
    files?: string[],
  ) => Promise<void | CommandResult>,
  full = false,
  output?: (chunk: Buffer) => void,
  providedInputs?: InputSnapshot,
  providedPlan?: VerificationPlan,
) {
  const inputs = providedInputs ?? (await snapshot(root));
  const started = performance.now();
  let log = '';
  let failures: string[] = [];
  const result = await runChecks(
    root,
    async (name, args, files) => {
      let output = '';
      try {
        return await execute(
          name,
          args,
          (chunk) => {
            output = (output + chunk.toString()).slice(-1024 * 1024);
          },
          files,
        );
      } catch (error) {
        if (error instanceof ReportedFailure && error.result.diagnostics) {
          const fs = await import('node:fs/promises');
          output +=
            '\n' +
            (await fs
              .readFile(error.result.diagnostics, 'utf8')
              .catch(() => 'Nested diagnostics expired.'));
        }
        failures = output
          .split('\n')
          .filter((line) => /error|warning|expected|actual|fail|:\d+:\d+/i.test(line))
          .slice(0, 3);
        if (!failures.length) failures = [name + ': ' + String(error)];
        throw error;
      } finally {
        log = (log + '\n' + name + '\n' + output).slice(-1024 * 1024);
      }
    },
    args.includes('--local'),
    full,
    inputs,
    providedPlan,
  );
  const report: CommandResult = {
    command: full ? 'check:full' : 'check',
    scope: `${full ? 'full' : 'affected'}; ${result.plan.suites.length} suites`,
    outcome: result.passed ? 'passed' : 'failed',
    unit: 'phases',
    executed: result.steps.filter((step) => step.status !== 'skipped' && !step.reused).length,
    reused: result.steps.filter((step) => step.reused).length,
    failed: result.steps.filter((step) => step.status === 'failed').length,
    skipped: result.steps.filter((step) => step.status === 'skipped').length,
    durationMs: performance.now() - started,
    selected: result.plan.suites,
    reasons: [
      ...result.plan.reasons,
      ...result.steps.map(
        (step) =>
          `${step.name}: ${step.reused ? 'reused' : step.status}${step.reason ? ' — ' + step.reason : ''}`,
      ),
    ],
    remaining: [
      'hosted CI and visible playtesting separate',
      ...(!full ? ['all-suite and exhaustive asset verification'] : []),
      'builds and packaged desktop coverage',
    ],
    timings: result.steps
      .filter((step) => step.ms !== undefined)
      .map((step) => ({ name: step.name, ms: step.ms! })),
    ...(result.tests
      ? {
          scope: `${full ? 'full' : 'affected'}; ${result.plan.suites.length} suites; tests ${result.tests.executed} executed/${result.tests.reused} reused checks`,
        }
      : {}),
  };
  if (!result.passed) {
    report.failures =
      result.tests?.failures ??
      (failures.length
        ? failures
        : result.steps
            .filter((step) => step.status === 'failed')
            .map((step) => step.name + ': ' + step.reason));
    report.diagnostics = await failureLog(log, 'check.log');
  }
  return publishResult(root, report, inputs, undefined, output);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    if (!(error instanceof ReportedFailure)) console.error(error.message);
    process.exitCode = 1;
  });

export async function checks({ context, definition, args, clean, env, output }: Invocation) {
  if (clean.length) throw new Error('Use check [--local]');
  if (definition.full) context.env = { ...context.env, LANTERN_FULL_VERIFICATION: '1' };
  await (
    await import('./check')
  ).check(
    projectRoot,
    args,
    async (name, argv, gateOutput, files) => {
      if (name === 'whitespace')
        await runProcess('git', ['diff', '--check'], {
          cwd: projectRoot,
          env,
          output: gateOutput,
        });
      else {
        const previous = context.env;
        context.env = {
          ...context.env,
          LANTERN_CHECK_FILES: files ? JSON.stringify(files) : undefined,
        };
        try {
          return await runNpmTask(context, argv, gateOutput);
        } finally {
          context.env = previous;
        }
      }
    },
    !!definition.full,
    output,
    await taskInputs(context),
    await taskPlan(context, !!definition.full),
  );
}
