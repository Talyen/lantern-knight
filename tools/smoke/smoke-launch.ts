import type { GameSave } from '../../src/core/save';
import { AssetCache, diskBytes } from '../assets/cache';
import { randomUUID } from 'node:crypto';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireTestLane } from '../verification';
export const option = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : (process.argv[i + 1] ?? fallback);
};
export function playerControls(page: Page, profile: string) {
  const pause = async () => {
    if (!(await page.locator('#modal').isVisible()))
      await page.getByRole('button', { name: 'Pause / save' }).click();
  };
  const resume = async () => {
    if (await page.locator('#modal').isVisible())
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.locator('canvas').focus();
  };
  const save = async () => {
    await pause();
    await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'Checkpoint saved',
    );
    return JSON.parse(await fs.readFile(path.join(profile, 'saves/game.json'), 'utf8')) as GameSave;
  };
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  return { pause, resume, save, frames };
}
type SmokeRun = Awaited<ReturnType<typeof launch>>;
type SmokeWork = { updates: number; submissions: number };
let completedWork: SmokeWork[] = [];
export function takeSmokeWork() {
  const work = completedWork;
  completedWork = [];
  return work.length
    ? work.reduce(
        (total, value) => ({
          updates: total.updates + value.updates,
          submissions: total.submissions + value.submissions,
        }),
        { updates: 0, submissions: 0 },
      )
    : undefined;
}
export async function observeWork(page: Page) {
  await page.waitForFunction(
    () => window.foundation?.ready || window.effectsPlayground?.ready,
    {},
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    // tsx preserves names of functions serialized into the browser by Playwright.
    Reflect.set(window, '__name', (fn: Function) => fn);
    if (!window.foundation) return; // Effects keeps its renderer private.
    const holder = window.foundation.presentation;
    const state = { updates: 0, submissions: 0, reported: false };
    Reflect.set(window, '__lanternSmokeWork', state);
    const method = window.foundation ? 'update' : 'render';
    const update = Reflect.get(holder, method) as Function;
    Reflect.set(holder, method, function (this: unknown, ...args: unknown[]) {
      state.updates++;
      return Reflect.apply(update, this, args);
    });
    const renderer = Reflect.get(holder, 'renderer');
    const render = Reflect.get(renderer, 'render') as Function;
    Reflect.set(renderer, 'render', function (this: unknown, ...args: unknown[]) {
      state.submissions++;
      return Reflect.apply(render, this, args);
    });
  });
}
async function collectWork(page: Page) {
  const value = await page.evaluate(() => {
    const state = Reflect.get(window, '__lanternSmokeWork') as
      (SmokeWork & { reported: boolean }) | undefined;
    if (!state || state.reported) return undefined;
    state.reported = true;
    return { updates: state.updates, submissions: state.submissions };
  });
  if (value) {
    completedWork.push(value);
    console.log(
      `Smoke work: ${value.updates} presentation updates; ${value.submissions} renderer submissions.`,
    );
  }
}
let sharedDev: SmokeRun | undefined;
let sharing = false;
export async function withSmokeSessions(work: () => Promise<void>) {
  if (sharing) throw new Error('Smoke suite is already active');
  sharing = true;
  try {
    await work();
  } finally {
    sharing = false;
    const run = sharedDev;
    sharedDev = undefined;
    await run?.close();
  }
}
export function smokeExecutable(dev: boolean, env: NodeJS.ProcessEnv = process.env) {
  const name = dev ? 'Lantern Knight Dev' : 'Lantern Knight';
  return (
    env.LANTERN_EXECUTABLE ??
    (process.platform === 'darwin'
      ? path.resolve(
          `${dev ? 'release-dev' : 'release'}/mac-arm64/${name}.app/Contents/MacOS/${name}`,
        )
      : path.resolve(`${dev ? 'release-dev' : 'release'}/win-unpacked/${name}.exe`))
  );
}
export async function smokeLaunch(
  dev: boolean,
  args: string[] = [],
  options: { budget?: number; retain?: boolean } = {},
) {
  if (sharing && dev && sharedDev) {
    const mode = args.includes('--effects') ? 'effects' : 'sandbox';
    await Promise.all([
      sharedDev.page.waitForEvent('load'),
      sharedDev.page.evaluate(
        (mode) => window.lantern!.launchMode!(mode as 'effects' | 'sandbox'),
        mode,
      ),
    ]);
    await observeWork(sharedDev.page);
    return { ...sharedDev, close: () => collectWork(sharedDev!.page) };
  }
  let lane: Awaited<ReturnType<typeof acquireTestLane>>;
  try {
    lane = await acquireTestLane();
  } catch (error) {
    // A refused run never creates a profile, but an explicitly requested diagnostic
    // still records the failure. Preserve any existing diagnostic in that folder.
    if (process.argv.includes('--output')) {
      const output = path.resolve(option('--output', ''));
      await fs.mkdir(output, { recursive: true });
      await fs
        .writeFile(
          path.join(output, 'failure.json'),
          JSON.stringify({
            stage: 'test-lane',
            error: String(error).slice(0, 2000),
          }),
          { flag: 'wx' },
        )
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        });
    }
    throw error;
  }
  try {
    const run = await launch(dev, args, options, () => lane.release());
    if (sharing && dev) {
      sharedDev = run;
      return { ...run, close: () => collectWork(run.page) };
    }
    return run;
  } catch (error) {
    await lane.release();
    throw error;
  }
}
async function launch(
  dev: boolean,
  args: string[],
  options: { budget?: number; retain?: boolean },
  releaseLane: () => Promise<void>,
) {
  const capture = process.argv.includes('--capture'),
    budget = options.budget ?? (capture ? 1024 ** 3 : 32 * 1024 ** 2),
    held = await new AssetCache().lease('diagnostics-' + randomUUID(), budget),
    managed = !process.argv.includes('--output');
  const output = managed ? path.join(held.root, 'results') : path.resolve(option('--output', ''));
  await fs.mkdir(output, { recursive: true });
  const parent = path.resolve(option('--profile', held.root));
  await fs.mkdir(parent, { recursive: true });
  const profile = await fs.mkdtemp(path.join(parent, 'lantern-smoke-'));
  const executable = smokeExecutable(dev);
  console.log(`Smoke launch: ${dev ? 'Dev' : 'Game'} (${args.join(' ') || 'default'}).`);
  let app: ElectronApplication | undefined, page: Page | undefined;
  const errors: string[] = [];
  const launchStarted = performance.now();
  try {
    app = await electron.launch({
      executablePath: executable,
      args: [
        ...(process.platform === 'win32' && process.env.CI === 'true'
          ? ['--use-gl=angle', '--use-angle=swiftshader']
          : []),
        ...args,
      ],
      env: {
        ...process.env,
        LANTERN_USER_DATA: profile,
        LANTERN_AUTOMATED_RUN: '1',
        // Hidden Windows windows can limit frame callbacks even with renderer
        // background throttling disabled. CI has its own isolated desktop.
        LANTERN_TEST_HIDDEN:
          process.argv.includes('--visible') ||
          (process.platform === 'win32' && process.env.CI === 'true')
            ? '0'
            : '1',
      },
      timeout: 30000,
    });
    page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    if (!dev) {
      await page.waitForFunction(
        () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
        {},
        { timeout: 45000 },
      );
    }
    if (dev) await observeWork(page);
    const readyMs = performance.now() - launchStarted,
      rendererReadyMs = await page.evaluate(() => performance.now());
    return {
      app,
      page,
      profile,
      output,
      executable,
      errors,
      capture,
      readyMs,
      rendererReadyMs,
      reportWork: () => collectWork(page!),
      async close() {
        try {
          if (dev) await collectWork(page!);
          await app!.close().catch((error) => {
            if (app!.process().exitCode === null) throw error;
          });
          await fs.rm(profile, { recursive: true, force: true });
          const failure = (await fs.readdir(output)).some((n) => /failure.*\.json$/.test(n));
          if (managed && !capture && !options.retain && !failure && !errors.length)
            await fs.rm(output, { recursive: true, force: true });
          else if (failure) console.error('Failure diagnostics: ' + output);
          if (capture && !failure && !errors.length && process.env.LANTERN_TASK_RESULT)
            await fs.writeFile(
              process.env.LANTERN_TASK_RESULT,
              JSON.stringify({ captureDirectories: [output] }),
            );
          if (managed && (await diskBytes(held.root)) > budget)
            throw new Error('Diagnostic output exceeded cache reservation');
        } finally {
          await releaseLane();
          await held.release();
          if (managed && !(await fs.readdir(held.root)).some((n) => n !== '.leases'))
            await fs.rm(held.root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    let startup: unknown;
    if (page) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        startup = await Promise.race([
          page.evaluate(() => ({
            url: location.href,
            status: document.querySelector('#status')?.textContent,
            ready: document.querySelector('canvas')?.getAttribute('data-ready'),
            resources: performance
              .getEntriesByType('resource')
              .slice(-12)
              .map((entry) => ({ name: entry.name, durationMs: Math.round(entry.duration) })),
          })),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve({ unavailable: 'Renderer did not respond' }), 2000);
          }),
        ]);
      } catch (diagnostic) {
        startup = { unavailable: String(diagnostic) };
      } finally {
        clearTimeout(timer);
      }
    }
    await fs.writeFile(
      path.join(output, 'failure.json'),
      JSON.stringify(
        {
          stage: 'startup',
          elapsedMs: Math.round(performance.now() - launchStarted),
          error: String(error),
          errors,
          startup,
        },
        null,
        2,
      ),
    );
    await app?.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
    console.error('Failure diagnostics: ' + output);
    await held.release();
    throw error;
  }
}
