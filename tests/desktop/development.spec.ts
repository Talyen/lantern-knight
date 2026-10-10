import net from 'node:net';
import { test, expect, chromium, type Browser } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runProcess } from '../../tools/run-process';
import { projectRoot } from '../../tools/assets/paths';
test('fresh source checkout: renderer reload, main/preload restart and owned shutdown', async () => {
  test.setTimeout(240_000);
  // Expand Windows 8.3 temp aliases before Vite starts native filesystem watchers.
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-live-'))),
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
    if (!process.env.npm_execpath) throw new Error('Run desktop integration through npm');
    await runProcess(
      process.execPath,
      [process.env.npm_execpath, 'ci', '--no-audit', '--no-fund'],
      {
        cwd: root,
        timeoutMs: 120_000,
        output: (chunk) => {
          log = (log + chunk.toString()).slice(-65536);
        },
      },
    );
    running = runProcess(
      process.execPath,
      ['--import', 'tsx', 'tools/desktop-dev.ts', '--game', '--remote-debugging-port=0'],
      {
        cwd: root,
        signal: controller.signal,
        env: {
          ...process.env,
          LANTERN_PREVIEW_PORT: String(port),
          LANTERN_USER_DATA: path.join(root, 'profile'),
          LANTERN_TEST_HIDDEN: '1',
          LANTERN_AUTOMATED_RUN: '1',
        },
        output: (chunk) => {
          const text = chunk.toString();
          log = (log + text).slice(-65536);
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
    await page.locator('#pause').click();
    await page.locator('#render-scale').selectOption('0.5');
    await page.evaluate(() => window.lantern!.loadSettings());
    expect(
      JSON.parse(
        await fs.readFile(path.join(root, 'profile/preview/prototype-saves/settings.json'), 'utf8'),
      ).renderScale,
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
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
