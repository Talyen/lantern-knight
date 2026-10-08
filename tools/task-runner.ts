import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { acquireCommandLane, withoutCommandLane } from './command-lane';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { AssetCache } from './assets/cache';
import { readLock, recipeHash, ensurePack, validatePack, LockSchema } from './assets/pack';
import { guardedBuild } from './verification';

type Workspace = { env: NodeJS.ProcessEnv; release: () => Promise<void> };
export type TaskContext = {
  captureDirectories?: string[];
  previewReloadVerified?: boolean;
  env: NodeJS.ProcessEnv;
  workspaces: Map<boolean, Workspace>;
  releaseAdmission: () => Promise<void>;
};
async function workspace(context: TaskContext, local: boolean) {
  const existing = context.workspaces.get(local);
  if (existing) return existing.env;
  const cache = new AssetCache();
  let held: Awaited<ReturnType<AssetCache['lease']>>, lock: Awaited<ReturnType<typeof readLock>>;
  if (local) {
    held = await cache.lease('preparation');
    try {
      lock = LockSchema.parse(
        JSON.parse(await fs.readFile(path.join(held.root, 'prepared.json'), 'utf8')),
      );
      if (lock.recipeSha256 !== (await recipeHash()))
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
    if (lock.recipeSha256 !== (await recipeHash()))
      throw new Error('Asset recipes differ from the pinned pack. Run assets:finalize.');
    held = await ensurePack(lock, cache);
  }
  const env = {
    ...context.env,
    LANTERN_ASSET_WORKSPACE: held.root,
    LANTERN_ASSET_SHA256: lock.sha256,
    LANTERN_ASSET_RECIPE_SHA256: lock.recipeSha256,
    LANTERN_PREPARING: '0',
  };
  context.workspaces.set(local, { env, release: held.release });
  console.log(`Asset setup: ${local ? 'local candidate' : lock.releaseTag}.`);
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
  operation: (invocation: Invocation) => Promise<void>;
  assets?: boolean;
  parse?: (args: string[]) => void | Promise<void>;
  file?: string;
  prefix?: string[];
  timeoutMs?: number;
  captures?: boolean;
  dev?: boolean;
  package?: { dev: boolean; host: 'mac' | 'win'; prebuilt: boolean };
  admission?: 'command' | 'startup';
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
  child: (file: string, args?: string[], timeoutMs?: number) => Promise<void>;
};
const noArgs = (args: string[]) => {
  if (args.length) throw new Error('Command accepts only --local');
};
const sceneArgs = async (args: string[]) => {
  (await import('./scene-workflow')).sceneOptions(args);
};
const leaf = (
  file: string,
  assets = false,
  prefix: string[] = [],
  captures = false,
): CommandDefinition => ({ operation: leafTask, file, assets, prefix, captures });
const dev = (file: string, prefix: string[] = []): CommandDefinition => ({
  operation: develop,
  file,
  prefix,
  assets: true,
  admission: 'startup',
});
export const commands: Record<string, CommandDefinition> = {
  check: { operation: checks, parse: noArgs },
  'check:task': { operation: taskCheck, parse: sceneArgs },
  test: {
    operation: testTask,
    parse: async (args) => {
      await (await import('./test')).selectTestFiles(args, projectRoot);
    },
  },
  build: { operation: build, assets: true, parse: noArgs },
  'build:dev': { operation: build, assets: true, parse: noArgs, dev: true },
  'scene:check': {
    operation: sceneCheck,
    assets: true,
    parse: sceneArgs,
    prefix: ['check'],
    timeoutMs: 120000,
  },
  'scene:benchmark': {
    operation: sceneCheck,
    assets: true,
    parse: sceneArgs,
    prefix: ['benchmark'],
    timeoutMs: 120000,
  },
  'scene:dev': { ...dev('tools/scene-workflow.ts', ['dev']), parse: sceneArgs },
  'scene:editor': dev('tools/scene-editor.ts'),
  'scene:editor:check': leaf('tools/scene-editor-check.ts', true),
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
  format: leaf('tools/format.ts'),
  'format:check': leaf('tools/format.ts', false, ['--check']),
  'build:verify': leaf('tools/build-identity.ts', true),
  'build:dev:verify': leaf('tools/build-identity.ts', true, ['--dev']),
  'assets:check': leaf('tools/check-assets.ts', true),
  'assets:ensure': { operation: inspectAssets, parse: noArgs },
  'assets:inspect': {
    operation: inspectAssets,
    parse: (args) => {
      if (args.length > 1 || args.some((a) => a.startsWith('--')))
        throw new Error('Supply one asset ID');
    },
  },
  'assets:prepare': {
    operation: prepare,
    parse: (args) => {
      if (args.some((a) => a !== '--proof')) throw new Error('Preparation accepts only --proof');
    },
  },
  'assets:finalize': { operation: finalize },
  'assets:clean': { operation: cleanAssets, parse: noArgs },
  'assets:sources:check': leaf('tools/assets/library.py', false, ['check']),
  'assets:dedupe': leaf('tools/assets/library.py', false, ['dedupe']),
  'smoke:game': leaf('tools/game-smoke.ts', true, [], true),
  'smoke:sandbox': leaf('tools/churchyard-smoke.ts', true, [], true),
  'smoke:animation': leaf('tools/animation-smoke.ts', true, [], true),
  'smoke:art': leaf('tools/ink-art-smoke.ts', true, [], true),
  'smoke:hero': leaf('tools/hero-smoke.ts', true, [], true),
  'smoke:lighting': leaf('tools/lighting-smoke.ts', true, [], true),
  'smoke:crypt': leaf('tools/crypt-smoke.ts', true, [], true),
  'smoke:effects': leaf('tools/effects-playground-smoke.ts', true, [], true),
  'smoke:graveyard': leaf('tools/graveyard-smoke.ts', true, [], true),
  'smoke:visual-options': leaf('tools/visual-options-smoke.ts', true, [], true),
  'smoke:visual-scenes': leaf('tools/visual-scenes-smoke.ts', true, [], true),
  benchmark: leaf('tools/churchyard-smoke.ts', true, ['--benchmark']),
  'benchmark:game': leaf('tools/game-smoke.ts', true, ['--benchmark']),
};
commands.smoke = commands['smoke:game']!;
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
export async function runTask(
  context: TaskContext,
  task: string,
  args: string[] = [],
  output?: (chunk: Buffer) => void,
) {
  if (!Object.hasOwn(commands, task)) throw new Error('Unknown managed task: ' + task);
  const definition = commands[task]!;
  const local = args.includes('--local'),
    clean = args.filter((a) => a !== '--local');
  if (clean.includes('--skip-reload') && !context.previewReloadVerified)
    throw new Error('Reload reuse requires a successful scene check in this task');
  await definition.parse?.(clean);
  context.captureDirectories = [];
  const env = definition.assets ? await workspace(context, local) : context.env;
  const child = (
    file: string,
    argv: string[] = [],
    timeoutMs = definition.timeoutMs ?? 5 * 60 * 1000,
  ) =>
    runProcess(
      file.endsWith('.py') ? 'python3' : process.execPath,
      [
        ...(file.endsWith('.py') ? ['-B'] : file.endsWith('.ts') ? ['--import', 'tsx'] : []),
        path.resolve(projectRoot, file),
        ...argv,
      ],
      { cwd: projectRoot, env, timeoutMs, output },
    );
  await definition.operation({ context, task, args, clean, local, env, output, child, definition });
}
async function testTask({ context, clean, local, output }: Invocation) {
  const { selectTestFiles, runTests } = await import('./test');
  const awaitedFiles = await selectTestFiles(clean, projectRoot);
  await withTaskEnv(context.env, () =>
    runTests(awaitedFiles, async () => workspace(context, local), output),
  );
}

async function checks({ context, args, clean, env }: Invocation) {
  if (clean.length) throw new Error('Use check [--local]');
  await (
    await import('./check')
  ).check(projectRoot, args, async (name, argv, gateOutput) => {
    if (name === 'whitespace')
      await runProcess('git', ['diff', '--check'], {
        cwd: projectRoot,
        env,
        output: gateOutput,
      });
    else await runNpmTask(context, argv, gateOutput);
  });
}
async function taskCheck({ context, args, local }: Invocation) {
  const options = (await import('./scene-workflow')).sceneOptions(args);
  const { verificationIdentity, requireStableInputs } = await import('./verification');
  const before = await verificationIdentity(projectRoot);
  await runTask(context, 'check', local ? ['--local'] : []);
  await runTask(context, 'scene:check', [
    '--scene',
    options.scene,
    ...(options.capture ? ['--capture'] : []),
    ...(local ? ['--local'] : []),
  ]);
  await requireStableInputs(projectRoot, before);
  console.log('PASS: full regular gates and selected scene acceptance.');
}
async function build({ clean, env, output, child, definition }: Invocation) {
  if (clean.length) throw new Error('Build accepts only --local');
  const dev = definition.dev ?? false,
    identity = path.join(projectRoot, dev ? 'dist-dev' : 'dist', 'build-identity.json');
  await guardedBuild(projectRoot, identity, async (before) => {
    await child('node_modules/typescript/bin/tsc', ['--noEmit']);
    await child('node_modules/vite/bin/vite.js', ['build', ...(dev ? ['--mode', 'sandbox'] : [])]);
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
  });
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
    'tools/scene-workflow.ts',
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
  if (clean.some((a) => a !== '--proof')) throw new Error('Preparation accepts only --proof');
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
      const { assetCatalog } = await import('../src/content/asset-catalog');
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
  await child('node_modules/electron-builder/cli.js', [
    ...(dev ? ['--config', 'electron-builder.dev.json'] : []),
    '--' + host,
    host === 'mac' ? '--arm64' : '--x64',
    '--dir',
  ]);
}
async function leafTask({ context, clean, env, output, child, definition }: Invocation) {
  const argv = [...(definition.prefix ?? []), ...clean];
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
  const lane = await acquireCommandLane({
    cwd: projectRoot,
    command: [task, ...args].join(' '),
  });
  const context: TaskContext = {
    env: lane.env,
    workspaces: new Map(),
    releaseAdmission: lane.release,
  };
  console.log(`Command admission: ${lane.waitMs}ms.`);
  try {
    await runTask(context, task, args);
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
    console.error(error.message);
    process.exitCode = 1;
  });
