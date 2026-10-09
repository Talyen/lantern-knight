import { createRequire } from 'node:module';
import { context } from 'esbuild';
import { developmentServer, untilInterrupted } from './dev';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { electronConfig } from './build-electron';
const electron = createRequire(import.meta.url)('electron') as string;
const session = await developmentServer();
const ready = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let active: AbortController | undefined,
  running = Promise.resolve(),
  closed = false;
const restart = () => {
  if (closed || ready.size !== 2) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    active?.abort();
    running = running.then(async () => {
      if (closed) return;
      const controller = new AbortController();
      active = controller;
      console.log('Starting Electron against ' + session.origin);
      try {
        await runProcess(electron, ['dist-electron-dev/main.cjs', ...process.argv.slice(2)], {
          cwd: projectRoot,
          env: { ...process.env, LANTERN_DEV_URL: session.origin },
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) console.error(error);
      }
    });
  }, 100);
};
const builders = [];
try {
  for (const name of ['main', 'preload'] as const) {
    const builder = await context({
      ...electronConfig(name, true),
      plugins: [
        {
          name: 'restart-electron',
          setup(build) {
            build.onEnd((result) => {
              if (!result.errors.length) {
                ready.add(name);
                restart();
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
} finally {
  closed = true;
  clearTimeout(timer);
  active?.abort();
  await Promise.all(builders.map((builder) => builder.dispose()));
  await running;
  await session.close();
}
