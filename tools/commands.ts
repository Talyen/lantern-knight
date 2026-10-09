import type { AssetMode } from './assets/workspace';
import { build, packageApp, e2e, fullVerification, buildVerification } from './delivery';
import { checks } from './check';
import { testTask } from './test';
import { probeTask, taskCheck, sceneCheck } from './scene/scene-workflow';
import { develop } from './scene/preview-session';
import {
  preparationArgs,
  currentPin,
  finalize,
  prepare,
  inspectAssets,
  cleanAssets,
} from './assets/commands';
import { leafTask, type CommandDefinition, type Invocation } from './task-context';
import { projectRoot } from './assets/paths';
const noArgs = (args: string[]) => {
  if (args.length) throw new Error('Command accepts only --local');
};
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
  kind: 'capture',
  reuse: { entry: file, package: 'dev' },
});
const dev = (file: string, prefix: string[] = []): CommandDefinition => ({
  operation: develop,
  file,
  prefix,
  assets: true,
  kind: 'dev',
  deadlineMs: null,
  admission: 'startup',
  assetMode: 'preview',
});
export const commands: Record<string, CommandDefinition> = {
  check: { operation: checks, parse: noArgs, admission: 'none', assetMode: 'preview' },
  'task:start': {
    contextArgs: 'start',
    operation: async ({ clean, context }) => {
      const root = context.testRoot ?? projectRoot;
      const { taskStartArgs } = await import('./agent-context');
      const { name, paths } = taskStartArgs(clean, root);
      await (await import('./task-state')).startTask(root, name, paths);
    },
    admission: 'none',
  },
  'agent:context': {
    contextArgs: 'paths',
    operation: async ({ clean, context, output }) => {
      const { agentContext } = await import('./agent-context');
      const result = await agentContext(context.testRoot ?? projectRoot, clean);
      if (output) output(Buffer.from(result.text + '\n'));
      else console.log(result.text);
    },
    admission: 'none',
  },
  'check:full': { operation: checks, parse: noArgs, full: true },
  'test:full': { operation: testTask, parse: noArgs, kind: 'tests', full: true },
  'assets:pin:current': { deadlineMs: null, operation: currentPin, parse: noArgs },
  'verify:build': { operation: buildVerification, parse: noArgs, full: true },
  'verify:full': { operation: fullVerification, parse: noArgs, full: true, deadlineMs: 9 * 60_000 },
  'test:e2e': {
    deadlineMs: (platform) => (platform === 'win32' ? 3 : 5) * 60_000,
    operation: e2e,
    parse: (args) => {
      if (args.length > 1 || args.some((a) => a !== '--full'))
        throw new Error('Use test:e2e [--full]');
      if (!['darwin', 'win32'].includes(process.platform))
        throw new Error('E2E requires macOS or Windows');
    },
  },
  'check:task': { operation: taskCheck, parse: sceneArgs },
  test: {
    kind: 'tests',
    operation: testTask,
    assetMode: 'preview',
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
    reuse: { entry: 'tools/scene/scene-workflow.ts' },
    operation: sceneCheck,
    assets: true,
    assetMode: 'preview',
    parse: sceneArgs,
    prefix: ['check'],
    timeoutMs: 120000,
  },
  'scene:probe': {
    operation: probeTask,
    probe: 'scene',
    assets: true,
    assetMode: 'preview',
    parse: sceneArgs,
  },
  'ui:probe': {
    operation: probeTask,
    probe: 'loading',
    assets: true,
    assetMode: 'preview',
    parse: noArgs,
  },
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
    assetMode: 'preview',
    parse: sceneArgs,
    prefix: ['benchmark'],
    timeoutMs: 120000,
  },
  'scene:dev': { ...dev('tools/scene/scene-workflow.ts', ['dev']), parse: sceneArgs },
  'scene:editor': dev('tools/scene/scene-editor.ts'),
  'scene:editor:check': {
    reuse: { entry: 'tools/scene/scene-editor-check.ts' },
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
  format: { ...leaf('tools/format.ts'), kind: 'format' },
  'format:check': { ...leaf('tools/format.ts', false, ['--check']), kind: 'format' },
  'build:restore': {
    assets: true,
    parse: noArgs,
    operation: async ({ env }) => {
      await (
        await import('./build-assets')
      ).restoreBuildAssets(
        projectRoot,
        env.LANTERN_ASSET_WORKSPACE!,
        env.LANTERN_ASSET_SHA256!,
        env.GITHUB_SHA,
      );
    },
  },
  'build:verify': leaf('tools/build-identity.ts', true),
  'build:dev:verify': leaf('tools/build-identity.ts', true, ['--dev']),
  'assets:check': { ...leaf('tools/check-assets.ts', true), summary: true },
  'assets:ensure': { deadlineMs: null, operation: inspectAssets, assets: true, parse: noArgs },
  'assets:inspect': {
    deadlineMs: null,
    operation: inspectAssets,
    inspection: true,
    assets: true,
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
    deadlineMs: null,
    operation: prepare,
    parse: (args) => {
      preparationArgs(args);
    },
  },
  'assets:dev': {
    deadlineMs: null,
    operation: prepare,
    parse: (args) => {
      const ids = preparationArgs(args);
      if (!ids.length) throw new Error('Use assets:dev --ids <asset-id>...');
    },
  },
  'assets:finalize': { operation: finalize, kind: 'finalize', deadlineMs: null },
  'assets:clean': { deadlineMs: null, operation: cleanAssets, parse: noArgs },
  'assets:sources:check': {
    ...leaf('tools/assets/library.py', false, ['check']),
    deadlineMs: null,
  },
  'assets:dedupe': { ...leaf('tools/assets/library.py', false, ['dedupe']), deadlineMs: null },
  'smoke:game': smoke('tools/smoke/game-smoke.ts'),
  'smoke:desktop': { ...leaf('tools/smoke/desktop-smoke.ts', true), timeoutMs: 120000 },
  'smoke:sandbox': smoke('tools/smoke/churchyard-smoke.ts'),
  'smoke:animation': smoke('tools/smoke/animation-smoke.ts'),
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
for (const host of ['mac', 'win'] as const)
  for (const dev of [false, true])
    for (const prebuilt of [false, true]) {
      const name = `package:${dev ? 'dev:' : ''}${host}${prebuilt ? ':prebuilt' : ''}`;
      commands[name] = { operation: packageApp, parse: noArgs, package: { dev, host, prebuilt } };
    }
for (const definition of Object.values(commands)) {
  if (definition.deadlineMs === undefined) definition.deadlineMs = 5 * 60_000;
  if (definition.parse === sceneArgs) definition.kind = 'scene';
  if (definition.captures && !definition.kind) definition.kind = 'capture';
}
commands['smoke:game']!.reuse!.package = 'player';
commands['smoke:visual-options']!.reuse!.package = 'player';
commands['smoke:desktop']!.reuse = { entry: 'tools/smoke/desktop-smoke.ts', package: 'both' };
commands['smoke:desktop']!.kind = 'capture';
commands.benchmark!.kind = 'capture';
commands['benchmark:game']!.kind = 'capture';

export async function checkCommandScripts(scripts: Record<string, string>) {
  for (const [name, script] of Object.entries(scripts)) {
    const match = /^tsx tools\/task-runner\.ts (\S+)$/.exec(script);
    if (match && (!Object.hasOwn(commands, match[1]!) || match[1] !== name))
      throw new Error('Unregistered managed npm command: ' + name);
  }
}
export type ParsedTask = Pick<
  Invocation,
  'task' | 'args' | 'clean' | 'local' | 'assetMode' | 'definition' | 'testFiles' | 'scene'
>;
export async function parseTask(
  task: string,
  args: string[] = [],
  root = projectRoot,
): Promise<ParsedTask> {
  if (!Object.hasOwn(commands, task)) throw new Error('Unknown managed task: ' + task);
  if (commands[task]!.kind === 'scene' || task === 'scene:editor' || task === 'scene:editor:check')
    (await import('./scene/scene-server')).scenePreviewPort();
  if (commands[task]!.contextArgs) {
    const m = await import('./agent-context');
    if (commands[task]!.contextArgs === 'start') m.taskStartArgs(args, root);
    else m.contextPaths(root, args);
    return {
      task,
      args,
      clean: args,
      local: false,
      assetMode: 'published',
      definition: commands[task]!,
    };
  }
  if (args.filter((a) => a === '--local').length > 1) throw new Error('Supply --local once');
  const definition = commands[task]!,
    local = args.includes('--local'),
    clean = args.filter((a) => a !== '--local');
  let assetMode: AssetMode = local ? 'candidate' : (definition.assetMode ?? 'published');
  const selection = clean.indexOf('--assets');
  if (selection >= 0) {
    const mode = clean[selection + 1];
    if (
      local ||
      !['published', 'candidate', 'preview'].includes(mode ?? '') ||
      clean.lastIndexOf('--assets') !== selection
    )
      throw new Error(
        'Use --assets published|candidate|preview once; --local is a candidate alias',
      );
    assetMode = mode as AssetMode;
    clean.splice(selection, 2);
  }
  let testFiles: string[] | undefined, scene: ParsedTask['scene'];
  if (definition.kind === 'tests') {
    if (definition.full) noArgs(clean);
    const available = await (await import('./test')).selectTestFiles(clean, root);
    if (clean.length) testFiles = available;
  } else if (definition.parse === sceneArgs)
    scene = (await import('./scene/scene-workflow')).sceneOptions(clean);
  else if (definition.parse) await definition.parse(clean);
  else if (definition.kind === 'finalize') {
    const rest = clean.filter((a) => a !== '--full' && a !== '--bundles');
    if (
      clean.filter((a) => a === '--full').length > 1 ||
      clean.filter((a) => a === '--bundles').length > 1 ||
      (rest.length &&
        !(rest.length === 2 && rest[0] === '--reviewed' && /^[a-f0-9]{64}$/.test(rest[1]!)))
    )
      throw new Error('Use assets:finalize [--full] [--reviewed <review-id>]');
  } else if (definition.kind === 'capture') {
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
  } else if (definition.kind === 'format') {
    if (clean.some((a) => a !== '--check') || clean.length > 1)
      throw new Error('Use format [--check]');
  } else if (definition.kind === 'dev') {
    const flags = new Set(['--open', '--strictPort', '--force', '--debug']),
      values = new Set(['--host', '--port', '--mode', '--base', '--config', '--logLevel']);
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i]!;
      if (values.has(a)) {
        if (!clean[++i] || clean[i]!.startsWith('--')) throw new Error('Missing value: ' + a);
      } else if (!flags.has(a)) throw new Error('Unknown development option: ' + a);
    }
  } else noArgs(clean);
  return {
    task,
    args,
    clean,
    local: assetMode === 'candidate',
    assetMode,
    definition,
    testFiles,
    scene,
  };
}
