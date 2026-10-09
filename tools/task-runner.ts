import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireCommandLane, withoutCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { AssetCache } from './assets/cache';
import {
  readLock,
  recipeHash,
  ensurePack,
  validatePack,
  LockSchema,
  acceptedRecipe,
} from './assets/pack';
import { guardedBuild, verificationIdentity, requireStableInputs } from './verification';
import { taskBudget, executionDeadline } from './task-budget';
import { preparationSelection } from './assets/recipe';
import { publishResult, failureLog, ReportedFailure, type CommandResult } from './command-report';

type Workspace = { env: NodeJS.ProcessEnv; release: () => Promise<void> };
export type TaskContext = {
  testRoot?: string;
  captureDirectories?: string[];
  previewReloadVerified?: boolean;
  env: NodeJS.ProcessEnv;
  workspaces: Map<boolean | string, Workspace>;
  releaseAdmission: () => Promise<void>;
};
async function workspace(context: TaskContext, local: boolean, prototype = false) {
  // An explicit candidate selection must never be replaced by a prototype layer.
  prototype = prototype && !local;
  const key = prototype ? 'prototype' : local;
  const existing = context.workspaces.get(key);
  if (existing) return existing.env;
  const cache = new AssetCache();
  let held: Awaited<ReturnType<AssetCache['lease']>>, lock: Awaited<ReturnType<typeof readLock>>;
  if (prototype) {
    const selected = await (await import('./assets/preview')).prototypeAssets(cache);
    const env = {
      ...context.env,
      LANTERN_ASSET_WORKSPACE: selected.held.root,
      LANTERN_ASSET_SHA256: selected.lock.sha256,
      LANTERN_ASSET_RECIPE_SHA256: selected.lock.recipeSha256,
      LANTERN_ASSET_ARCHIVE_RECIPE_SHA256: selected.lock.recipeSha256,
      LANTERN_PREPARING: '0',
    };
    context.workspaces.set(key, { env, release: () => selected.held.release() });
    return env;
  } else if (local) {
    held = await cache.lease('preparation');
    try {
      lock = LockSchema.parse(
        JSON.parse(await fs.readFile(path.join(held.root, 'prepared.json'), 'utf8')),
      );
      if (acceptedRecipe(lock) !== (await recipeHash()))
        throw new Error('Local preparation recipe differs; prepare again');
      const payload = path.join(held.root, 'work/payload');
      await validatePack(payload, lock);
      held = { ...held, root: payload };
    } catch (error) {
      await held.release();
      throw error;
    }
  } else {
    lock = await readLock();
    if (acceptedRecipe(lock) !== (await recipeHash()))
      throw new Error('Asset recipes differ from the pinned pack. Run assets:finalize.');
    held = await ensurePack(lock, cache);
  }
  const env: NodeJS.ProcessEnv = {
    ...context.env,
    LANTERN_ASSET_WORKSPACE: held.root,
    LANTERN_ASSET_SHA256: lock.sha256,
    LANTERN_ASSET_RECIPE_SHA256: acceptedRecipe(lock),
    LANTERN_ASSET_ARCHIVE_RECIPE_SHA256: lock.recipeSha256,
    LANTERN_PREPARING: '0',
  };
  context.workspaces.set(local, { env, release: () => held.release() });
  return env;
}
export async function withTaskEnv<T>(env: NodeJS.ProcessEnv, work: () => Promise<T>) {
  const keys = Object.keys(env).filter((key) => key.startsWith('LANTERN_')),
    previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = env[key];
  try {
    return await work();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
type CommandDefinition = {
  operation: (invocation: Invocation) => Promise<void | CommandResult>;
  assets?: boolean;
  parse?: (args: string[]) => void | Promise<void>;
  file?: string;
  prefix?: string[];
  timeoutMs?: number;
  captures?: boolean;
  dev?: boolean;
  package?: { dev: boolean; host: 'mac' | 'win'; prebuilt: boolean };
  admission?: 'command' | 'startup' | 'none';
  summary?: boolean;
};
type Invocation = {
  context: TaskContext;
  task: string;
  args: string[];
  clean: string[];
  local: boolean;
  env: NodeJS.ProcessEnv;
  output?: (chunk: Buffer) => void;
  definition: CommandDefinition;
  testFiles?: string[];
  scene?: { scene: string; capture: boolean; local: boolean; skipReload: boolean };
  child: (
    file: string,
    args?: string[],
    timeoutMs?: number,
    output?: (chunk: Buffer) => void,
  ) => Promise<void>;
};
const noArgs = (args: string[]) => {
  if (args.length) throw new Error('Command accepts only --local');
};
function preparationArgs(args: string[]) {
  const ids: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--proof') continue;
    if (args[i] !== '--ids' || ids.length)
      throw new Error('Use assets:prepare [--proof] [--ids <asset-id>...]');
    while (i + 1 < args.length && !args[i + 1]!.startsWith('--')) ids.push(args[++i]!);
    if (!ids.length) throw new Error('Supply asset IDs after --ids');
  }
  if (ids.length) preparationSelectionForArgs(ids);
  if (ids.length && args.includes('--proof'))
    throw new Error('Ground proof requires full explicit preparation');
  return ids;
}
function preparationSelectionForArgs(ids: string[]) {
  for (const id of ids)
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error('Invalid asset ID: ' + id);
  preparationSelection(ids);
}
const lintArgs = (args: string[]) => {
  if (args.length > 1 || args.some((arg) => arg !== '--fix'))
    throw new Error('Use lint[:js|:py] [--fix]');
};
const sceneArgs = async (args: string[]) => {
  (await import('./scene/scene-workflow')).sceneOptions(args);
};
const leaf = (
  file: string,
  assets = false,
  prefix: string[] = [],
  captures = false,
): CommandDefinition => ({ operation: leafTask, file, assets, prefix, captures });
const smoke = (file: string): CommandDefinition => ({
  ...leaf(file, true, [], true),
  timeoutMs: 5 * 60 * 1000,
});
const dev = (file: string, prefix: string[] = []): CommandDefinition => ({
  operation: develop,
  file,
  prefix,
  assets: true,
  admission: 'startup',
});
export const commands: Record<string, CommandDefinition> = {
  check: { operation: checks, parse: noArgs, admission: 'none' },
  'task:start': {
    operation: async ({ clean, context }) => {
      const root = context.testRoot ?? projectRoot;
      const { taskStartArgs } = await import('./agent-context');
      const { name, paths } = taskStartArgs(clean, root);
      await (await import('./task-state')).startTask(root, name, paths);
    },
    admission: 'none',
  },
  'agent:context': {
    operation: async ({ clean, context, output }) => {
      const { agentContext } = await import('./agent-context');
      const result = await agentContext(context.testRoot ?? projectRoot, clean);
      if (output) output(Buffer.from(result.text + '\n'));
      else console.log(result.text);
    },
    admission: 'none',
  },
  'check:full': { operation: checks, parse: noArgs },
  'test:full': { operation: testTask, parse: noArgs },
  'assets:pin:current': { operation: currentPin, parse: noArgs },
  'verify:full': { operation: fullVerification, parse: noArgs },
  'test:e2e': { operation: e2e, parse: noArgs },
  'check:task': { operation: taskCheck, parse: sceneArgs },
  test: {
    operation: testTask,
    parse: async (args) => {
      await (await import('./test')).selectTestFiles(args, projectRoot);
    },
  },
  build: { operation: build, assets: true, parse: noArgs },
  'build:dev': { operation: build, assets: true, parse: noArgs, dev: true },
  'scene:convert': {
    parse: async (args) => {
      (await import('./scene/scene-convert')).conversionOptions(args);
    },
    operation: async ({ clean }) => {
      await (await import('./scene/scene-convert')).convertScene(clean);
    },
  },
  'scene:check': {
    operation: sceneCheck,
    assets: true,
    parse: sceneArgs,
    prefix: ['check'],
    timeoutMs: 120000,
  },
  'scene:probe': { operation: probeTask, assets: true, parse: sceneArgs },
  'ui:probe': { operation: probeTask, assets: true, parse: noArgs },
  'prototype:stop': {
    operation: async () => {
      await (await import('./scene/prototype-browser')).stopPrototypeBrowser();
    },
    parse: noArgs,
    admission: 'none',
  },
  'scene:benchmark': {
    operation: sceneCheck,
    assets: true,
    parse: sceneArgs,
    prefix: ['benchmark'],
    timeoutMs: 120000,
  },
  'scene:dev': { ...dev('tools/scene/scene-workflow.ts', ['dev']), parse: sceneArgs },
  'scene:editor': dev('tools/scene/scene-editor.ts'),
  'scene:editor:check': {
    ...leaf('tools/scene/scene-editor-check.ts', true, [], true),
    parse: (args) => {
      if (args.some((a) => a !== '--capture'))
        throw new Error('Use scene:editor:check [--capture]');
    },
  },
  dev: dev('node_modules/vite/bin/vite.js', ['--host', '127.0.0.1']),
  'dev:sandbox': dev('node_modules/vite/bin/vite.js', [
    '--host',
    '127.0.0.1',
    '--mode',
    'sandbox',
    '--open',
    '/sandbox.html',
  ]),
  'dev:effects': dev('node_modules/vite/bin/vite.js', [
    '--host',
    '127.0.0.1',
    '--mode',
    'sandbox',
    '--open',
    '/effects.html',
  ]),
  typecheck: leaf('node_modules/typescript/bin/tsc', false, ['--noEmit']),
  'repo:check': leaf('tools/check-repository.ts'),
  'architecture:check': leaf('tools/check-architecture.ts'),
  'docs:check': leaf('tools/check-docs.ts'),
  lint: { ...leaf('tools/lint.ts', false, ['all']), parse: lintArgs },
  'lint:js': { ...leaf('tools/lint.ts', false, ['js']), parse: lintArgs },
  'lint:py': { ...leaf('tools/lint.ts', false, ['py']), parse: lintArgs },
  knip: { ...leaf('tools/lint.ts', false, ['knip']), parse: noArgs },
  format: leaf('tools/format.ts'),
  'format:check': leaf('tools/format.ts', false, ['--check']),
  'build:verify': leaf('tools/build-identity.ts', true),
  'build:dev:verify': leaf('tools/build-identity.ts', true, ['--dev']),
  'assets:check': { ...leaf('tools/check-assets.ts', true), summary: true },
  'assets:ensure': { operation: inspectAssets, parse: noArgs },
  'assets:inspect': {
    operation: inspectAssets,
    parse: async (args) => {
      if (args.length > 1 || args.some((a) => a.startsWith('--')))
        throw new Error('Supply one asset ID');
      if (args[0]) {
        const { assetCatalog } = await import('../src/content/asset-catalog');
        if (!Object.hasOwn(assetCatalog, args[0]) && !/^library-[a-z0-9_-]+$/.test(args[0]))
          throw new Error('Unknown asset ID');
      }
    },
  },
  'assets:prepare': {
    operation: prepare,
    parse: (args) => {
      preparationArgs(args);
    },
  },
  'assets:dev': {
    operation: prepare,
    parse: (args) => {
      const ids = preparationArgs(args);
      if (!ids.length) throw new Error('Use assets:dev --ids <asset-id>...');
    },
  },
  'assets:finalize': { operation: finalize },
  'assets:clean': { operation: cleanAssets, parse: noArgs },
  'assets:sources:check': leaf('tools/assets/library.py', false, ['check']),
  'assets:dedupe': leaf('tools/assets/library.py', false, ['dedupe']),
  'smoke:game': smoke('tools/smoke/game-smoke.ts'),
  'smoke:desktop': { ...leaf('tools/smoke/desktop-smoke.ts', true), timeoutMs: 120000 },
  'smoke:sandbox': smoke('tools/smoke/churchyard-smoke.ts'),
  'smoke:animation': smoke('tools/smoke/animation-smoke.ts'),
  'smoke:art': smoke('tools/smoke/churchyard-smoke.ts'),
  'smoke:hero': smoke('tools/smoke/hero-smoke.ts'),
  'smoke:lighting': smoke('tools/smoke/lighting-smoke.ts'),
  'smoke:crypt': smoke('tools/smoke/crypt-smoke.ts'),
  'smoke:effects': smoke('tools/smoke/effects-playground-smoke.ts'),
  'smoke:graveyard': smoke('tools/smoke/graveyard-smoke.ts'),
  'smoke:visual-options': smoke('tools/smoke/visual-options-smoke.ts'),
  'smoke:visual-scenes': smoke('tools/smoke/visual-scenes-smoke.ts'),
  benchmark: leaf('tools/smoke/churchyard-smoke.ts', true, ['--benchmark']),
  'benchmark:game': leaf('tools/smoke/game-smoke.ts', true, ['--benchmark']),
};
for (const name of [
  'typecheck',
  'lint',
  'lint:js',
  'lint:py',
  'knip',
  'format:check',
  'docs:check',
  'repo:check',
  'architecture:check',
  'assets:pin:current',
]) {
  const definition = commands[name]!;
  definition.admission = 'none';
  definition.summary = definition.operation === leafTask;
}
commands.smoke = commands['smoke:desktop']!;
commands['assets:publish'] = commands['assets:finalize']!;
for (const host of ['mac', 'win'] as const)
  for (const dev of [false, true])
    for (const prebuilt of [false, true]) {
      const name = `package:${dev ? 'dev:' : ''}${host}${prebuilt ? ':prebuilt' : ''}`;
      commands[name] = { operation: packageApp, parse: noArgs, package: { dev, host, prebuilt } };
    }
export async function checkCommandScripts(scripts: Record<string, string>) {
  for (const [name, script] of Object.entries(scripts)) {
    const match = /^tsx tools\/task-runner\.ts (\S+)$/.exec(script);
    if (match && (!Object.hasOwn(commands, match[1]!) || match[1] !== name))
      throw new Error('Unregistered managed npm command: ' + name);
  }
}
export type ParsedTask = Pick<
  Invocation,
  'task' | 'args' | 'clean' | 'local' | 'definition' | 'testFiles' | 'scene'
>;
export async function parseTask(
  task: string,
  args: string[] = [],
  root = projectRoot,
): Promise<ParsedTask> {
  if (!Object.hasOwn(commands, task)) throw new Error('Unknown managed task: ' + task);
  if (task !== 'scene:convert' && (task.startsWith('scene:') || task === 'check:task'))
    (await import('./scene/scene-server')).scenePreviewPort();
  if (['task:start', 'agent:context'].includes(task)) {
    const m = await import('./agent-context');
    if (task === 'task:start') m.taskStartArgs(args, root);
    else m.contextPaths(root, args);
    return { task, args, clean: args, local: false, definition: commands[task]! };
  }
  if (args.filter((a) => a === '--local').length > 1) throw new Error('Supply --local once');
  const definition = commands[task]!,
    local = args.includes('--local'),
    clean = args.filter((a) => a !== '--local');
  let testFiles: string[] | undefined, scene: ParsedTask['scene'];
  if (task === 'test' || task === 'test:full') {
    if (task === 'test:full') noArgs(clean);
    const available = await (await import('./test')).selectTestFiles(clean, root);
    if (clean.length) testFiles = available;
  } else if (definition.parse === sceneArgs)
    scene = (await import('./scene/scene-workflow')).sceneOptions(clean);
  else if (definition.parse) await definition.parse(clean);
  else if (task === 'assets:finalize' || task === 'assets:publish') {
    const rest = clean.filter((a) => a !== '--full' && a !== '--bundles');
    if (
      clean.filter((a) => a === '--full').length > 1 ||
      clean.filter((a) => a === '--bundles').length > 1 ||
      (rest.length &&
        !(rest.length === 2 && rest[0] === '--reviewed' && /^[a-f0-9]{64}$/.test(rest[1]!)))
    )
      throw new Error('Use assets:finalize [--full] [--reviewed <review-id>]');
  } else if (definition.captures || task === 'benchmark' || task === 'benchmark:game') {
    const flags = new Set([
      '--capture',
      '--visible',
      '--quick',
      '--stills',
      '--ci',
      '--benchmark',
      '--software',
      '--benchmark-only',
      '--no-benchmark',
    ]);
    const values = new Set([
      '--output',
      '--profile',
      '--area',
      '--render-scale',
      '--hardware',
      '--warmup-ms',
      '--duration-ms',
    ]);
    const seen = new Set<string>();
    for (let i = 0; i < clean.length; i++) {
      const flag = clean[i]!;
      if (seen.has(flag)) throw new Error('Duplicate option: ' + flag);
      seen.add(flag);
      if (values.has(flag)) {
        const value = clean[++i];
        if (!value || value.startsWith('--')) throw new Error('Missing value: ' + flag);
      } else if (!flags.has(flag)) throw new Error('Unknown option: ' + flag);
    }
  } else if (task === 'scene:editor:check') {
    if (clean.length > 1 || clean.some((a) => a !== '--capture'))
      throw new Error('Use scene:editor:check [--capture]');
  } else if (task === 'format:check' || task === 'format') {
    if (clean.some((a) => a !== '--check') || clean.length > 1)
      throw new Error('Use format [--check]');
  } else if (definition.admission === 'startup') {
    const flags = new Set(['--open', '--strictPort', '--force', '--debug']),
      values = new Set(['--host', '--port', '--mode', '--base', '--config', '--logLevel']);
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i]!;
      if (values.has(a)) {
        if (!clean[++i] || clean[i]!.startsWith('--')) throw new Error('Missing value: ' + a);
      } else if (!flags.has(a)) throw new Error('Unknown development option: ' + a);
    }
  } else noArgs(clean);
  return { task, args, clean, local, definition, testFiles, scene };
}
export async function runTask(
  context: TaskContext,
  task: string,
  args: string[] = [],
  output?: (chunk: Buffer) => void,
  parsed?: ParsedTask,
) {
  const invocation = parsed ?? (await parseTask(task, args, context.testRoot ?? projectRoot));
  const { definition, local, clean, testFiles, scene } = invocation;
  if (clean.includes('--skip-reload') && !context.previewReloadVerified)
    throw new Error('Reload reuse requires a successful scene check in this task');
  context.captureDirectories = [];
  const budget = taskBudget(task);
  const env: NodeJS.ProcessEnv = {
    ...(definition.assets
      ? await workspace(
          context,
          local,
          process.env.CI !== 'true' &&
            context.env.LANTERN_FULL_VERIFICATION !== '1' &&
            (definition.admission === 'startup' ||
              ['scene:probe', 'ui:probe', 'scene:check', 'scene:editor:check'].includes(task)),
        )
      : context.env),
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
  const previousEnv = context.env;
  context.env = env;
  try {
    const invocation = {
      context,
      task,
      args,
      clean,
      local,
      env,
      output,
      child,
      definition,
      testFiles,
      scene,
    };
    if (
      (task.startsWith('smoke:') || task === 'scene:check' || task === 'scene:editor:check') &&
      process.env.CI !== 'true'
    ) {
      const { reusableDeliveryPhase } = await import('./phase-run');
      const packaged = task.startsWith('smoke:');
      const devPackage = !['smoke:game', 'smoke:visual-options'].includes(task);
      const executables = packaged
        ? await import('./smoke/smoke-launch').then(({ smokeExecutable }) =>
            task === 'smoke:desktop'
              ? [smokeExecutable(false), smokeExecutable(true)]
              : [smokeExecutable(devPackage)],
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
        name: task,
        entry: definition.file ?? 'tools/scene/scene-workflow.ts',
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
    context.env = previousEnv;
  }
}
async function e2e({ context, args, child }: Invocation) {
  if (!['darwin', 'win32'].includes(process.platform))
    throw new Error('E2E requires macOS or Windows');
  const before = await verificationIdentity(projectRoot);
  for (const task of ['build:verify', 'build:dev:verify']) await runTask(context, task, args);
  await child('tools/smoke/e2e.ts', [], taskBudget('test:e2e'));
  await requireStableInputs(projectRoot, before);
}
async function fullVerification({ context, args }: Invocation) {
  if (!['darwin', 'win32'].includes(process.platform))
    throw new Error('Full verification requires macOS or Windows');
  const before = await verificationIdentity(projectRoot),
    host = process.platform === 'darwin' ? 'mac' : 'win';
  context.env = { ...context.env, LANTERN_FULL_VERIFICATION: '1' };
  for (const task of [
    'check:full',
    'build',
    'build:dev',
    `package:${host}:prebuilt`,
    `package:dev:${host}:prebuilt`,
    'test:e2e',
  ]) {
    const started = performance.now();
    await runTask(context, task, args);
    console.log(`Verification phase ${task}: ${Math.round(performance.now() - started)}ms.`);
  }
  await requireStableInputs(projectRoot, before);
  console.log(
    'PASS: complete host verification; other platforms and visible playtesting require separate evidence.',
  );
}

async function testTask({
  context,
  task,
  testFiles,
  local,
  output,
}: Invocation): Promise<CommandResult> {
  const { selectTestFiles, runTests, TestExecutionFailure } = await import('./test');
  const root = context.testRoot ?? projectRoot;
  const { verificationPlan, dependencyInputs } = await import('./verification-plan');
  const plan = testFiles
    ? undefined
    : await verificationPlan(root, { full: task === 'test:full', prototype: task === 'test' });
  const selected = await selectTestFiles(testFiles ?? plan!.suites, root);
  // selectTestFiles([]) means all for explicit invocations, not an empty affected plan.
  const files = plan && !plan.suites.length ? [] : selected;
  const full = task === 'test:full' || context.env.LANTERN_FULL_VERIFICATION === '1';
  const { snapshot, inputKey, phaseEvidence } = await import('./task-state');
  const inputs = await snapshot(root);
  const names = full
    ? undefined
    : [
        ...new Set([
          ...(await dependencyInputs(root, files, inputs)),
          'tools/test.ts',
          'tools/task-runner.ts',
          'tools/task-state.ts',
          'tools/command-report.ts',
          'tools/run-process.ts',
          'tools/verification.ts',
          'tools/verification-plan.ts',
          'tools/command-lane.ts',
        ]),
      ];
  const started = performance.now();
  const result: CommandResult = {
    command: task,
    scope: `${files.length} suite${files.length === 1 ? '' : 's'}; ${plan ? (plan.full ? 'full' : 'affected') : 'explicit'}`,
    outcome: files.length ? 'passed' : 'not-run',
    unit: 'checks',
    executed: 0,
    reused: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    selected: files,
    reasons: plan?.reasons ?? ['Explicit test selection'],
    remaining: ['local scope only; hosted CI and visible playtesting separate'],
    timings: [],
  };
  try {
    if (files.length) {
      const before = await verificationIdentity(root, {
        ignoreAssetPin: true,
        ...(names ? { files: names } : {}),
      });
      const execute = async () => {
        const tests = await withTaskEnv(
          {
            ...context.env,
            ...(names ? { LANTERN_VERIFICATION_FILES: JSON.stringify(names) } : {}),
          },
          () =>
            runTests(
              files,
              async () => workspace(context, local, !full && process.env.CI !== 'true'),
              undefined,
              root,
            ),
        );
        await requireStableInputs(root, before, {
          ignoreAssetPin: true,
          ...(names ? { files: names } : {}),
        });
        // Receipts contain scope/counts/timings, never replayable terminal output.
        return { passed: tests.passed, failed: tests.failed, timings: tests.timings };
      };
      const key = inputKey(
        inputs,
        names ?? Object.keys(inputs.files),
        'tests-v2:' +
          process.platform +
          ':' +
          process.version +
          ':' +
          JSON.stringify(files) +
          ':' +
          local,
      );
      const proof = full
        ? { result: await execute(), reused: false }
        : await phaseEvidence(root, 'tests:' + files.join(','), key, execute);
      result[proof.reused ? 'reused' : 'executed'] = proof.result.passed;
      result.timings = proof.result.timings.map((t) => ({ name: t.file, ms: t.ms }));
    } else result.reasons.push('No affected suites; no tests executed.');
  } catch (error) {
    result.outcome = 'failed';
    if (error instanceof TestExecutionFailure) {
      result.executed = error.result.passed + error.result.failed;
      result.failed = error.result.failed;
      result.failures = error.result.messages.length ? error.result.messages : [error.message];
      result.timings = error.result.timings.map((t) => ({ name: t.file, ms: t.ms }));
      result.diagnostics = await failureLog(
        error.result.details + '\n' + error.message,
        'tests.log',
      );
    } else {
      result.failures = [String(error)];
    }
  }
  result.durationMs = performance.now() - started;
  return publishResult(root, result, inputs, names, output);
}

async function probeTask({ task, scene, env, context, clean, output }: Invocation) {
  if (scene?.capture) return runTask(context, 'scene:check', clean, output);
  const { snapshot } = await import('./task-state');
  const inputs = await snapshot(projectRoot),
    started = performance.now();
  const result: CommandResult = {
    command: task,
    scope: task === 'ui:probe' ? 'loading interaction' : scene!.scene + ' scene',
    outcome: 'passed',
    unit: 'checks',
    executed: 1,
    reused: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
    selected: [task === 'ui:probe' ? 'loading' : scene!.scene],
    reasons: ['targeted production component'],
    remaining: ['exhaustive renderer/platform/delivery coverage; visible playtesting'],
    timings: [],
  };
  try {
    await withTaskEnv(env, () =>
      import('./scene/prototype-browser').then((m) =>
        m.prototypeProbe(scene?.scene ?? 'court', task === 'ui:probe'),
      ),
    );
    // Compare authored inputs, including additions/deletions, before claiming a current pass.
    const after = await snapshot(projectRoot);
    if (JSON.stringify(inputs.files) !== JSON.stringify(after.files))
      throw new Error('Inputs changed during probe');
  } catch (error) {
    result.outcome = 'failed';
    result.failed = 1;
    result.failures = [String(error)];
    result.diagnostics = await failureLog(String(error), 'probe.log');
  }
  result.durationMs = performance.now() - started;
  return publishResult(projectRoot, result, inputs, undefined, output);
}

async function currentPin({ local }: Invocation) {
  await (await import('./check-asset-pin')).checkCurrentAssetPin(projectRoot, local);
  console.log(
    'PASS: current asset recipe matches the ' +
      (local ? 'local preparation' : 'published pack pin') +
      '; no artwork acquired.',
  );
}
async function checks({ context, task, args, clean, env, output }: Invocation) {
  if (clean.length) throw new Error('Use check [--local]');
  if (task === 'check:full') context.env = { ...context.env, LANTERN_FULL_VERIFICATION: '1' };
  await (
    await import('./check')
  ).check(
    projectRoot,
    args,
    async (name, argv, gateOutput) => {
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
          ...(process.env.LANTERN_CHECK_FILES
            ? { LANTERN_CHECK_FILES: process.env.LANTERN_CHECK_FILES }
            : {}),
        };
        try {
          return await runNpmTask(context, argv, gateOutput);
        } finally {
          context.env = previous;
        }
      }
    },
    task === 'check:full',
    output,
  );
}
async function taskCheck({ context, scene, local }: Invocation) {
  const options = scene!;
  const { verificationIdentity, requireStableInputs } = await import('./verification');
  const before = await verificationIdentity(projectRoot);
  await runTask(context, 'check', local ? ['--local'] : []);
  await runTask(context, 'scene:probe', [
    '--scene',
    options.scene,
    ...(options.capture ? ['--capture'] : []),
    ...(local ? ['--local'] : []),
  ]);
  await requireStableInputs(projectRoot, before);
  console.log(
    'PASS: focused local handoff and selected scene acceptance; full regression coverage belongs to CI.',
  );
}
async function build({ clean, env, output, child, definition }: Invocation) {
  if (clean.length) throw new Error('Build accepts only --local');
  const dev = definition.dev ?? false,
    identity = path.join(projectRoot, dev ? 'dist-dev' : 'dist', 'build-identity.json');
  const execute = () =>
    guardedBuild(
      projectRoot,
      identity,
      async (before) => {
        await child('node_modules/typescript/bin/tsc', ['--noEmit']);
        await child('node_modules/vite/bin/vite.js', [
          'build',
          ...(dev ? ['--mode', 'sandbox'] : []),
        ]);
        await child('tools/select-runtime-assets.ts', dev ? ['--dev'] : []);
        await child('tools/build-electron.ts', dev ? ['--dev'] : []);
        await runProcess(
          process.execPath,
          ['--import', 'tsx', 'tools/build-identity.ts', ...(dev ? ['--dev'] : []), '--write'],
          {
            cwd: projectRoot,
            env: { ...env, LANTERN_BUILD_SOURCE: JSON.stringify(before) },
            output,
          },
        );
      },
      { scope: 'runtime' },
    );
  if (process.env.CI === 'true' || env.LANTERN_FULL_VERIFICATION === '1') return execute();
  const { phaseEvidence } = await import('./task-state');
  const { fileSignatures } = await import('./verified-files');
  const inputs = await verificationIdentity(projectRoot, { scope: 'runtime' });
  const key = [
    inputs.sha256,
    env.LANTERN_ASSET_SHA256,
    process.version,
    process.platform,
    dev,
    'build-v1',
  ].join(':');
  const result = await phaseEvidence(
    projectRoot,
    dev ? 'build:dev' : 'build',
    key,
    async () => {
      await execute();
      const data = JSON.parse(await fs.readFile(identity, 'utf8')) as {
        files: Record<string, string>;
      };
      return {
        signatures: await fileSignatures(projectRoot, [
          ...Object.keys(data.files),
          path.relative(projectRoot, identity),
        ]),
      };
    },
    async (proof) => {
      try {
        return (
          JSON.stringify(proof.signatures) ===
          JSON.stringify(await fileSignatures(projectRoot, Object.keys(proof.signatures)))
        );
      } catch {
        return false;
      }
    },
  );
  if (result.reused)
    console.log('Reused validated build: runtime inputs, pinned assets and output files match.');
}
async function captureChild(
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
async function sceneCheck({ context, clean, env, output, definition }: Invocation) {
  const result = await captureChild(
    'tools/scene/scene-workflow.ts',
    [definition.prefix![0]!, ...clean],
    env,
    definition.timeoutMs!,
    output,
  );
  context.captureDirectories = result.captureDirectories;
  if (result.report?.passed && typeof result.report.reloadMs === 'number')
    context.previewReloadVerified = true;
}
async function develop({ context, clean, env, output, definition }: Invocation) {
  if (definition.admission === 'startup') await context.releaseAdmission();
  await runProcess(
    process.execPath,
    ['--import', 'tsx', definition.file!, ...(definition.prefix ?? []), ...clean],
    { cwd: projectRoot, env: withoutCommandLane(env), output },
  );
}
async function finalize({ context, args }: Invocation) {
  await withTaskEnv(context.env, async () =>
    (await import('./assets/finalize')).finalizeAssets(args, async (argv) => {
      let log = '';
      await runNpmTask(context, argv, (chunk) => {
        log = (log + chunk.toString()).slice(-12000);
        process.stdout.write(chunk);
      });
      return {
        output: log,
        captureDirectories: context.captureDirectories ?? [],
      };
    }),
  );
}
async function prepare({ context, clean }: Invocation) {
  const ids = preparationArgs(clean);
  if (ids.length) {
    await withTaskEnv(context.env, () =>
      import('./assets/preview').then((m) => m.preparePreviewAssets(ids)),
    );
    return;
  }
  const prepared = await withTaskEnv(context.env, () =>
    import('./assets/prepare').then((m) =>
      m.prepareAssets(new AssetCache(), clean.includes('--proof')),
    ),
  );
  await prepared.held.release();
}
async function inspectAssets({ context, task, clean, local }: Invocation) {
  const selected = await workspace(context, local);
  if (task === 'assets:inspect')
    await withTaskEnv(selected, async () => {
      const assetCatalog = await (
        await import('./assets/authoring-catalog')
      ).readAuthoringCatalog();
      const { parseManifest } = await import('../src/assets/schema');
      const id = clean[0];
      if (!id) {
        console.log(`${Object.keys(assetCatalog).length} assets. Supply an asset ID.`);
        return;
      }
      const file = assetCatalog[id];
      if (!file) throw new Error('Unknown asset ID');
      const manifest = parseManifest(
        JSON.parse(
          await fs.readFile(path.join(selected.LANTERN_ASSET_WORKSPACE!, 'public', file), 'utf8'),
        ),
      );
      console.log(
        JSON.stringify(
          {
            id,
            canvas: manifest.asset.canvas,
            density: manifest.asset.density,
            frames: manifest.frames.length,
            pages: manifest.pages.length,
            clips: Object.keys(manifest.asset.clips),
          },
          null,
          2,
        ),
      );
    });
}
async function cleanAssets({ env }: Invocation) {
  await withTaskEnv(env, async () => {
    const { retainedPacks, obsoleteReleases, gh } = await import('./assets/retention');
    const cache = new AssetCache(),
      keep = await retainedPacks(await readLock()),
      obsolete = await obsoleteReleases(keep);
    for (const tag of obsolete) await gh(['release', 'delete', tag, '--cleanup-tag', '--yes']);
    const names = await fs.readdir(path.join(cache.root, 'entries'));
    const removed = await cache.clean(
      new Set(names.filter((n) => n.startsWith('pack-') && keep.has('assets-' + n.slice(5, 21)))),
    );
    console.log(`Cleaned ${obsolete.length} published packs and ${removed} unused entries.`);
  });
}
async function packageApp({ context, args, output, child, definition }: Invocation) {
  const { dev, host, prebuilt } = definition.package!;
  if (!host) throw new Error('Unknown package target');
  if (!prebuilt) await runTask(context, dev ? 'build:dev' : 'build', args, output);
  await child('tools/build-identity.ts', dev ? ['--dev'] : []);
  const execute = () =>
    child('node_modules/electron-builder/cli.js', [
      ...(dev ? ['--config', 'electron-builder.dev.json'] : []),
      '--' + host,
      host === 'mac' ? '--arm64' : '--x64',
      '--dir',
    ]);
  if (process.env.CI === 'true' || context.env.LANTERN_FULL_VERIFICATION === '1') return execute();
  const { phaseEvidence } = await import('./task-state');
  const { fileSignatures } = await import('./verified-files');
  const dist = dev ? 'dist-dev' : 'dist';
  const name = dev ? 'Lantern Knight Dev' : 'Lantern Knight';
  const release = dev ? 'release-dev' : 'release';
  const files =
    host === 'mac'
      ? [
          `${release}/mac-arm64/${name}.app/Contents/Resources/app.asar`,
          `${release}/mac-arm64/${name}.app/Contents/MacOS/${name}`,
        ]
      : [`${release}/win-unpacked/resources/app.asar`, `${release}/win-unpacked/${name}.exe`];
  const identity = await fs.readFile(path.join(projectRoot, dist, 'build-identity.json'), 'utf8');
  const config = await fs.readFile(
    path.join(projectRoot, dev ? 'electron-builder.dev.json' : 'package.json'),
    'utf8',
  );
  const key = identity + config + process.platform + host + 'package-v1';
  const proof = await phaseEvidence(
    projectRoot,
    'package:' + dev + ':' + host,
    key,
    async () => {
      await execute();
      return { signatures: await fileSignatures(projectRoot, files) };
    },
    async (value) => {
      try {
        return (
          JSON.stringify(value.signatures) ===
          JSON.stringify(await fileSignatures(projectRoot, files))
        );
      } catch {
        return false;
      }
    },
  );
  if (proof.reused) console.log('Reused matching validated package output.');
}
async function leafTask({ task, context, clean, env, output, child, definition }: Invocation) {
  const argv = [...(definition.prefix ?? []), ...clean];
  if (definition.summary && !clean.includes('--fix')) {
    const { snapshot } = await import('./task-state');
    const inputs = await snapshot(projectRoot),
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
      await child(definition.file!, argv, undefined, (chunk) => {
        log = (log + chunk.toString()).slice(-1024 * 1024);
      });
      if (JSON.stringify(inputs.files) !== JSON.stringify((await snapshot(projectRoot)).files))
        throw new Error('Inputs changed during ' + task);
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
    task === 'test' &&
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
