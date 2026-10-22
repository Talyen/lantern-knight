import { runCli } from './cli';
import { onAsyncExit } from './scope-exit';
import { createRequire } from 'node:module';
import { context } from 'esbuild';
import { untilInterrupted } from './run-process';
import { openPreview } from './preview-session';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { electronConfig } from './build-electron';
export function desktopRestarts(start: (signal: AbortSignal) => Promise<void>) {
  const ready = new Set<'main' | 'preload'>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | undefined,
    running = Promise.resolve(),
    closed = false;
  let revision = 0;
  const restart = () => {
    if (closed || ready.size !== 2) return;
    const requested = ++revision;
    clearTimeout(timer);
    timer = setTimeout(() => {
      active?.abort();
      running = running.then(async () => {
        if (closed || requested !== revision) return;
        const controller = new AbortController();
        active = controller;
        try {
          await start(controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) console.error(error);
        }
      });
    }, 100);
  };
  return {
    building(name: 'main' | 'preload') {
      ready.delete(name);
      revision++;
      clearTimeout(timer);
    },
    built(name: 'main' | 'preload') {
      ready.add(name);
      restart();
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      active?.abort();
      await running;
    },
  };
}

async function main() {
  const electron = createRequire(import.meta.url)('electron') as string;
  const session = await openPreview({
    output: 'development',
    assets: 'local',
    scope: process.argv.includes('--game') ? 'runtime' : 'authoring',
    port: Number(process.env.LANTERN_PREVIEW_PORT ?? 5174),
  });
  const restarts = desktopRestarts(async (signal) => {
    console.log('Starting Electron against ' + session.origin);
    await runProcess(electron, ['dist-electron-dev/main.cjs', ...process.argv.slice(2)], {
      cwd: projectRoot,
      env: { ...process.env, LANTERN_DEV_URL: session.origin },
      signal,
    });
  });
  const builders: import('esbuild').BuildContext[] = [];
  await using _scopeExit1 = onAsyncExit(async () => {
    await restarts.close();
    await Promise.all(builders.map((builder) => builder.dispose()));
    await session.close();
  });
  for (const name of ['main', 'preload'] as const) {
    const builder = await context({
      ...electronConfig(name, process.argv.includes('--game') ? 'game' : 'authoring'),
      outfile: `dist-electron-dev/${name}.cjs`,
      plugins: [
        {
          name: 'restart-electron',
          setup(build) {
            build.onStart(() => {
              restarts.building(name);
            });
            build.onEnd((result) => {
              if (!result.errors.length) {
                restarts.built(name);
              }
            });
          },
        },
      ],
    });
    builders.push(builder);
    await builder.watch();
  }
  await untilInterrupted();
}
runCli(import.meta.url, () => main());
