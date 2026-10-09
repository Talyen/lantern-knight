import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assetWorkspace, type AssetMode, type AssetWorkspace } from './assets/workspace';
import { projectRoot } from './assets/paths';
import { runProcess } from './run-process';
import { snapshot, inputKey, type InputSnapshot } from './task-state';
import { verificationPlan, type VerificationPlan } from './verification-plan';
import { publishResult, failureLog, type CommandResult } from './command-report';
type Workspace = AssetWorkspace;
export type TaskContext = {
  testRoot?: string;
  verification?: {
    inputs: InputSnapshot;
    plans?: Map<boolean, VerificationPlan>;
    typechecked?: string;
  };
  depth?: number;
  captureDirectories?: string[];
  previewReloadVerified?: boolean;
  assetMode?: AssetMode;
  env: NodeJS.ProcessEnv;
  workspaces: Map<AssetMode, Workspace>;
  releaseAdmission: () => Promise<void>;
};
export async function workspace(context: TaskContext, mode: AssetMode) {
  let held = context.workspaces.get(mode);
  if (!held) {
    held = await assetWorkspace(mode, context.env);
    context.workspaces.set(mode, held);
  }
  return held.env;
}
export type CommandDefinition = {
  operation: (invocation: Invocation) => Promise<void | CommandResult>;
  assets?: boolean;
  assetMode?: AssetMode;
  parse?: (args: string[]) => void | Promise<void>;
  file?: string;
  prefix?: string[];
  timeoutMs?: number;
  captures?: boolean;
  dev?: boolean;
  package?: { dev: boolean; host: 'mac' | 'win'; prebuilt: boolean };
  admission?: 'command' | 'startup' | 'none';
  summary?: boolean;
  deadlineMs?: number | null | ((platform: NodeJS.Platform) => number);
  kind?: 'tests' | 'scene' | 'finalize' | 'capture' | 'format' | 'dev';
  full?: boolean;
  contextArgs?: 'start' | 'paths';
  probe?: 'loading' | 'scene';
  inspection?: boolean;
  reuse?: { entry: string; package?: 'player' | 'dev' | 'both' };
};
export type Invocation = {
  context: TaskContext;
  task: string;
  args: string[];
  clean: string[];
  local: boolean;
  assetMode: AssetMode;
  env: NodeJS.ProcessEnv;
  output?: (chunk: Buffer) => void;
  definition: CommandDefinition;
  testFiles?: string[];
  scene?: { scene: string; capture: boolean; local: boolean; skipReload: boolean };
  run: (task: string, args?: string[], output?: (chunk: Buffer) => void) => Promise<unknown>;
  child: (
    file: string,
    args?: string[],
    timeoutMs?: number,
    output?: (chunk: Buffer) => void,
  ) => Promise<void>;
};
export async function captureChild(
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  output?: (chunk: Buffer) => void,
) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-task-result-')),
    resultFile = path.join(temporary, 'result.json');
  try {
    await runProcess(process.execPath, ['--import', 'tsx', file, ...args], {
      cwd: projectRoot,
      env: { ...env, LANTERN_TASK_RESULT: resultFile },
      timeoutMs,
      output,
    });
    const result = JSON.parse(await fs.readFile(resultFile, 'utf8')) as {
      captureDirectories: string[];
      report?: { passed: boolean; reloadMs: number | null };
    };
    if (
      !Array.isArray(result.captureDirectories) ||
      !result.captureDirectories.every((p) => typeof p === 'string')
    )
      throw new Error('Invalid task capture result');
    return result;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
export async function leafTask({
  task,
  context,
  clean,
  env,
  output,
  child,
  definition,
}: Invocation) {
  const argv = [...(definition.prefix ?? []), ...clean];
  if (definition.summary && !clean.includes('--fix')) {
    const { snapshot } = await import('./task-state');
    const inputs = await taskInputs(context),
      started = performance.now();
    const selected = env.LANTERN_CHECK_FILES
      ? (JSON.parse(env.LANTERN_CHECK_FILES) as string[])
      : [];
    let log = '';
    const result: CommandResult = {
      command: task,
      scope: selected.length ? `${selected.length} selected authored files` : 'authored repository',
      outcome: 'passed',
      unit: 'phases',
      executed: 1,
      reused: 0,
      failed: 0,
      skipped: 0,
      durationMs: 0,
      selected,
      reasons: [],
      remaining: ['tests/browser/integration as applicable; hosted CI separate'],
      timings: [],
    };
    try {
      const typeKey =
        task === 'typecheck'
          ? inputKey(
              inputs,
              Object.keys(inputs.files).filter(
                (file) =>
                  /^(?:src|electron|tools|tests|authoring|assets)\//.test(file) ||
                  /^(?:package|tsconfig)/.test(file),
              ),
              process.version + process.platform,
            )
          : undefined;
      const typeReused = typeKey && context.verification?.typechecked === typeKey;
      if (typeReused) {
        result.executed = 0;
        result.reused = 1;
      } else
        await child(definition.file!, argv, undefined, (chunk) => {
          log = (log + chunk.toString()).slice(-1024 * 1024);
        });
      if (JSON.stringify(inputs.files) !== JSON.stringify((await snapshot(projectRoot)).files))
        throw new Error('Inputs changed during ' + task);
      if (typeKey && context.verification) context.verification.typechecked = typeKey;
      // Preserve actionable warnings while discarding routine tool chatter.
      for (const line of log.split('\n').filter((line) => /\bwarning\b/i.test(line))) {
        if (output) output(Buffer.from(line + '\n'));
        else console.warn(line);
        result.reasons.push(line);
      }
    } catch (error) {
      result.outcome = 'failed';
      result.failed = 1;
      result.failures = log
        .split('\n')
        .filter((line) => line.trim())
        .slice(0, 3);
      if (!result.failures.length) result.failures = [String(error)];
      result.diagnostics = await failureLog(log + '\n' + String(error), 'tool.log');
    }
    result.durationMs = performance.now() - started;
    result.timings = [{ name: task, ms: Math.round(result.durationMs) }];
    return publishResult(projectRoot, result, inputs, undefined, output);
  }
  if (clean.includes('--capture') && definition.captures) {
    const result = await captureChild(
      definition.file!,
      argv,
      env,
      definition.timeoutMs ?? 5 * 60 * 1000,
      output,
    );
    context.captureDirectories = result.captureDirectories;
  } else await child(definition.file!, argv);
}

export async function taskInputs(context: TaskContext) {
  context.verification ??= { inputs: await snapshot(context.testRoot ?? projectRoot) };
  return context.verification.inputs;
}

export async function taskPlan(context: TaskContext, full: boolean) {
  const inputs = await taskInputs(context);
  const plans = (context.verification!.plans ??= new Map<boolean, VerificationPlan>());
  let plan = plans.get(full);
  if (!plan) {
    plan = await verificationPlan(context.testRoot ?? projectRoot, {
      full,
      prototype: !full,
      inputs,
    });
    plans.set(full, plan);
  }
  return plan;
}
