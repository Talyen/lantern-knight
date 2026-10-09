import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { taskBudget, executionDeadline } from './task-budget';
import { failureLog, publishResult, ReportedFailure, type CommandResult } from './command-report';
import { parseTask, type ParsedTask } from './commands';
import { workspace, taskInputs, type TaskContext } from './task-context';
export { commands, parseTask, checkCommandScripts } from './commands';
export type { TaskContext, Invocation } from './task-context';
export async function runTask(
  context: TaskContext,
  task: string,
  args: string[] = [],
  output?: (chunk: Buffer) => void,
  parsed?: ParsedTask,
) {
  const invocation = parsed ?? (await parseTask(task, args, context.testRoot ?? projectRoot));
  const { definition, local, clean, testFiles, scene } = invocation;
  const assetMode =
    args.includes('--local') || args.includes('--assets')
      ? invocation.assetMode
      : (context.assetMode ?? invocation.assetMode);
  if (clean.includes('--skip-reload') && !context.previewReloadVerified)
    throw new Error('Reload reuse requires a successful scene check in this task');
  if (!context.depth) context.verification = undefined;
  await taskInputs(context);
  context.captureDirectories = [];
  const budget = taskBudget(task);
  const env: NodeJS.ProcessEnv = {
    ...(definition.assets ? await workspace(context, assetMode) : context.env),
    ...(budget
      ? {
          LANTERN_EXECUTION_DEADLINE: executionDeadline(
            budget,
            context.env.LANTERN_EXECUTION_DEADLINE,
          ),
        }
      : {}),
  };
  const child = (
    file: string,
    argv: string[] = [],
    timeoutMs = definition.timeoutMs ?? 5 * 60 * 1000,
    childOutput = output,
  ) =>
    runProcess(
      file.endsWith('.py') ? 'python3' : process.execPath,
      [
        ...(file.endsWith('.py') ? ['-B'] : file.endsWith('.ts') ? ['--import', 'tsx'] : []),
        path.resolve(projectRoot, file),
        ...argv,
      ],
      { cwd: projectRoot, env, timeoutMs, output: childOutput },
    );
  const parent = context;
  context = { ...context, env, assetMode, depth: (context.depth ?? 0) + 1, captureDirectories: [] };
  try {
    const invocation = {
      context,
      run: (name: string, args: string[] = [], sink?: (chunk: Buffer) => void) =>
        runTask(context, name, args, sink),
      task,
      args,
      clean,
      local,
      assetMode,
      env,
      output,
      child,
      definition,
      testFiles,
      scene,
    };
    if (definition.reuse && env.CI !== 'true') {
      const { reusableDeliveryPhase } = await import('./phase-run');
      const reuse = definition.reuse;
      const executables = reuse.package
        ? await import('./smoke/smoke-launch').then(({ smokeExecutable }) =>
            reuse.package === 'both'
              ? [smokeExecutable(false, env), smokeExecutable(true, env)]
              : [smokeExecutable(reuse.package === 'dev', env)],
          )
        : [];
      const outputFiles = executables.flatMap((executable) => [
        path.relative(projectRoot, executable),
        path.relative(
          projectRoot,
          process.platform === 'darwin'
            ? path.resolve(path.dirname(executable), '../Resources/app.asar')
            : path.join(path.dirname(executable), 'resources/app.asar'),
        ),
      ]);
      // Explicit external executables retain fresh verification instead of local-output reuse.
      if (outputFiles.some((file) => file.startsWith('..') || path.isAbsolute(file))) {
        await definition.operation(invocation);
        return;
      }
      context.captureDirectories = await reusableDeliveryPhase(projectRoot, {
        inputs: await taskInputs(context),
        name: task,
        entry: reuse.entry,
        args,
        assets: env.LANTERN_ASSET_SHA256,
        ...(outputFiles.length ? { outputFiles } : {}),
        run: async () => {
          await definition.operation(invocation);
          return context.captureDirectories ?? [];
        },
      });
    } else return await definition.operation(invocation);
  } finally {
    parent.captureDirectories = context.captureDirectories;
    parent.previewReloadVerified = context.previewReloadVerified;
  }
}
export async function runNpmTask(
  context: TaskContext,
  args: string[],
  output?: (chunk: Buffer) => void,
) {
  const [verb, name, ...rest] = args;
  if (verb === 'test')
    return runTask(
      context,
      'test',
      args.slice(1).filter((a) => a !== '--'),
      output,
    );
  if (verb !== 'run' || !name) throw new Error('Unsupported composite command');
  return runTask(
    context,
    name,
    rest.filter((a) => a !== '--'),
    output,
  );
}
export async function managedTask(task: string, args: string[]) {
  const parsed = await parseTask(task, args);
  const pureTest =
    parsed.definition.kind === 'tests' &&
    !parsed.definition.full &&
    (parsed.testFiles
      ? (await import('./test')).testGroups(parsed.testFiles).assets.length === 0
      : true);
  const lane =
    parsed.definition.admission === 'none' || pureTest
      ? {
          env: { ...process.env },
          waitMs: 0,
          release: async () => {},
        }
      : await acquireCommandLane({
          cwd: projectRoot,
          command: [task, ...args].join(' '),
        });
  const context: TaskContext = {
    env: lane.env,
    assetMode: process.env.CI === 'true' ? 'published' : undefined,
    workspaces: new Map(),
    releaseAdmission: () => lane.release(),
  };
  if (process.env.LANTERN_TASK_WORKER !== task && lane.waitMs > 10)
    console.log(`Command admission: ${lane.waitMs}ms.`);
  const started = Date.now(),
    budget = taskBudget(task);
  try {
    if (budget && process.env.LANTERN_TASK_WORKER !== task) {
      const deadline = executionDeadline(budget, context.env.LANTERN_EXECUTION_DEADLINE, started);
      let log = '';
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-supervisor-'));
      const resultFile = path.join(temporary, 'result.json');
      try {
        await runProcess(
          process.execPath,
          ['--import', 'tsx', 'tools/task-runner.ts', task, ...args],
          {
            cwd: projectRoot,
            env: {
              ...context.env,
              LANTERN_TASK_WORKER: task,
              LANTERN_EXECUTION_DEADLINE: deadline,
              LANTERN_SUPERVISOR_RESULT: resultFile,
            },
            timeoutMs: Number(deadline) - Date.now(),
            output: (chunk) => {
              log = (log + chunk.toString()).slice(-64 * 1024);
              process.stdout.write(chunk);
            },
          },
        );
      } catch (error) {
        let reported: { result: CommandResult; details: string } | undefined;
        try {
          reported = JSON.parse(await fs.readFile(resultFile, 'utf8'));
        } catch {}
        if (
          reported?.result.outcome === 'failed' &&
          !/deadline|interrupted|terminated|cleanup/.test(String(error))
        )
          throw new ReportedFailure(reported.result, reported.details);
        const { snapshot } = await import('./task-state');
        const diagnostics = await failureLog(log + '\n' + String(error), 'verification.log');
        const result: CommandResult = {
          command: task,
          scope: 'supervised execution',
          outcome: 'failed',
          unit: 'phases',
          executed: 0,
          reused: 0,
          failed: 1,
          skipped: 0,
          durationMs: Date.now() - started,
          selected: [],
          reasons: [],
          remaining: ['verification did not complete'],
          timings: [],
          failures: [String(error)],
          diagnostics,
        };
        await publishResult(projectRoot, result, await snapshot(projectRoot));
      } finally {
        await fs.rm(temporary, { recursive: true, force: true });
      }
    } else await runTask(context, task, args, undefined, parsed);
  } finally {
    try {
      for (const held of context.workspaces.values()) await held.release();
    } finally {
      await lane.release();
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  managedTask(process.argv[2] ?? '', process.argv.slice(3)).catch((error) => {
    if (!(error instanceof ReportedFailure)) console.error(error.message);
    process.exitCode = 1;
  });
