import { readJson } from '../../tools/json-file';
import net from 'node:net';
import { test, expect, chromium, type Browser } from '@playwright/test';
import { prepareStatePage } from '../fixtures/rasterization';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { runProcess } from '../../tools/run-process';
import { projectRoot } from '../../tools/assets/paths';
import { readLock, PackSchema } from '../../tools/assets/pack';
import { openRepositoryWorkspace } from '../../tools/assets/repository';
import { selectedFiles } from '../../tools/select-runtime-assets';

async function copyRuntimeAssets(root: string) {
  const pin = await readLock();
  if (pin.schemaVersion !== 5) throw new Error('Fresh checkout requires repository-owned assets');
  const relative = `asset-data/inventories/${pin.inventorySha256}.json.gz`;
  const inventory = PackSchema.parse(
    JSON.parse(gunzipSync(await fs.readFile(path.join(projectRoot, relative))).toString()),
  );
  const workspace = await openRepositoryWorkspace(pin, 'runtime', true);
  const required = new Set<string>();
  try {
    // Include every metadata read as well as selected pages; the launched Game
    // must authenticate its own copies through the normal repository workspace.
    await selectedFiles(workspace.publicDirectory, 'runtime', async (name) => {
      required.add('public/' + name);
      return workspace.ensurePublicFile(name);
    });
  } finally {
    await workspace.release();
  }
  const files = new Set([
    relative,
    ...[...required].map((name) => {
      const hash = inventory.files[name]!.sha256;
      return `asset-data/objects/${hash.slice(0, 2)}/${hash}`;
    }),
  ]);
  for (const name of files) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(projectRoot, name), target, constants.COPYFILE_FICLONE);
  }
  console.log(`Copied ${files.size} owned runtime asset files into the fresh checkout`);
}

async function copyDependencies(root: string) {
  const started = performance.now();
  const dependencies = path.join(projectRoot, 'node_modules');
  const packages: string[] = [];
  for (const name of await fs.readdir(dependencies)) {
    if (name.startsWith('@'))
      for (const child of await fs.readdir(path.join(dependencies, name)))
        packages.push(path.join(name, child));
    else packages.push(name);
  }
  // Copies and watcher caches remain checkout-local. Package copies are
  // independent; drain each bounded batch before cleanup on any failure.
  for (let offset = 0; offset < packages.length; offset += 8) {
    const results = await Promise.allSettled(
      packages.slice(offset, offset + 8).map(async (name) => {
        const target = path.join(root, 'node_modules', name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.cp(path.join(dependencies, name), target, {
          recursive: true,
          verbatimSymlinks: true,
          mode: constants.COPYFILE_FICLONE,
          filter: (source) =>
            !/^(?:\.vite|\.cache)(?:\/|$)/.test(
              path.relative(dependencies, source).split(path.sep).join('/'),
            ),
        });
      }),
    );
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  console.log(`Installed dependencies copied in ${Math.round(performance.now() - started)}ms`);
}

test('fresh source checkout: renderer reload, main/preload restart and owned shutdown', async () => {
  test.setTimeout(8 * 60_000);
  // Expand Windows 8.3 temp aliases before Vite starts native filesystem watchers.
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-live-'))),
    root = path.join(workspace, 'checkout'),
    profile = path.join(workspace, 'profile'),
    controller = new AbortController();
  let browser: Browser | undefined,
    running: Promise<void> | undefined,
    log = '',
    failure: unknown;
  const endpoints: string[] = [];
  const reservation = net.createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  try {
    for (const directory of ['src', 'electron', 'tools', 'authoring', 'assets'])
      await fs.cp(path.join(projectRoot, directory), path.join(root, directory), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
    for (const file of [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'sandbox.html',
      'editor.html',
      'effects.html',
    ])
      await fs.copyFile(path.join(projectRoot, file), path.join(root, file));
    await copyRuntimeAssets(root);
    // CI verifies npm ci once. This copy keeps dependencies and watcher caches checkout-local.
    await copyDependencies(root);
    console.log('Starting the fresh-checkout development command');
    running = runProcess(
      process.execPath,
      [
        '--import',
        'tsx',
        'tools/desktop-dev.ts',
        '--game',
        '--remote-debugging-port=0',
        '--force-device-scale-factor=0.5',
      ],
      {
        cwd: root,
        signal: controller.signal,
        env: {
          ...process.env,
          LANTERN_PREVIEW_PORT: String(port),
          // Chromium's changing/locked databases must stay outside Vite's source watcher.
          LANTERN_USER_DATA: profile,
          LANTERN_TEST_HIDDEN: '1',
          LANTERN_AUTOMATED_RUN: '1',
        },
        output: (chunk) => {
          const text = chunk.toString();
          log = (log + text).slice(-65536);
          if (text.includes('Starting Electron against '))
            console.log('Development command is launching Electron');
          for (const match of text.matchAll(/DevTools listening on (ws:\/\/[^\s]+)/g))
            endpoints.push(match[1]!);
        },
      },
    ).catch((error) => {
      if (!controller.signal.aborted) failure = error;
    });
    await expect.poll(() => endpoints.length, { timeout: 60_000, message: log }).toBeGreaterThan(0);
    browser = await chromium.connectOverCDP(endpoints[0]!);
    let page = browser.contexts()[0]!.pages()[0]!;
    await prepareStatePage(page);
    await page.waitForFunction(
      () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    );
    expect(
      (await (await page.request.get(new URL('/__lantern_identity', page.url()).href)).json())
        .scope,
    ).toBe('runtime');
    expect(await page.evaluate(() => typeof window.lantern?.launchMode)).toBe('undefined');
    await expect(page.locator('nav[aria-label="Developer tools"]')).toHaveCount(0);
    page.on('console', (message) => console.log('Development browser: ' + message.text()));
    console.log('Live Game ready');
    await page.locator('#menu-settings').click();
    await page.locator('#render-scale').selectOption('0.5');
    await page.evaluate(() => window.lantern!.loadSettings());
    expect(
      (await readJson(path.join(profile, 'preview/prototype-saves/settings.json'))).renderScale,
    ).toBe(0.5);
    const renderStarted = performance.now();
    await fs.appendFile(
      path.join(root, 'src/developer-nav.ts'),
      "\ndocument.documentElement.dataset.hmrProof='renderer-reloaded';\n",
    );
    console.log('Renderer source updated');
    await page.waitForFunction(
      () => document.documentElement.dataset.hmrProof === 'renderer-reloaded',
      {},
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    );
    console.log(
      'Renderer reload verified: ' + Math.round(performance.now() - renderStarted) + 'ms',
    );
    for (const [file, marker] of [
      ['electron/main.ts', 'main-restarted'],
      ['electron/preload.ts', 'preload-restarted'],
    ]) {
      console.log('Changing ' + file);
      const before = endpoints.length;
      await fs.appendFile(path.join(root, file!), `\nconsole.log('${marker}');\n`);
      await expect.poll(() => endpoints.length, { timeout: 45_000 }).toBeGreaterThan(before);
      await browser.close().catch(() => {});
      browser = await chromium.connectOverCDP(endpoints.at(-1)!);
      page = browser.contexts()[0]!.pages()[0]!;
      await prepareStatePage(page);
      await page.waitForFunction(
        () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
      );
    }
    console.log('Main and preload restart verified');
    expect(failure).toBeUndefined();
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    controller.abort();
    await running;
    await browser?.close().catch(() => {});
    await fs.rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
