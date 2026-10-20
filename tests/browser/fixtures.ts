import { test as base, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { projectRoot } from '../../tools/assets/paths';
const test = base.extend<{ errors: string[]; rasterize: boolean }>({
  rasterize: [true, { option: true }],
  context: async ({ playwright, browserName, video, rasterize }, use, testInfo) => {
    // End the process after each case: destroying a context alone can strand
    // Chromium's software graphics driver and block the next context.
    const browser = await playwright[browserName].launch();
    try {
      const mode = typeof video === 'string' ? video : video.mode;
      const record =
        mode === 'on' ||
        mode === 'retain-on-failure' ||
        (mode === 'on-first-retry' && testInfo.retry === 1) ||
        (mode === 'on-all-retries' && testInfo.retry > 0);
      // Playwright applies configured context options to manually created contexts.
      const context = await browser.newContext(
        record
          ? {
              recordVideo: {
                dir: testInfo.outputPath('video'),
                size: typeof video === 'string' ? undefined : video.size,
              },
            }
          : {},
      );
      if (!rasterize && !Object.keys(process.env).some((key) => /CAPTURE|CAPTURES/.test(key)))
        await context.addInitScript(() => {
          // State/DOM integration still creates real contexts, uploads assets,
          // compiles shaders and retires resources. Its unused pixels need no draws.
          for (const name of [
            'drawArrays',
            'drawElements',
            'drawArraysInstanced',
            'drawElementsInstanced',
          ])
            Object.defineProperty(WebGL2RenderingContext.prototype, name, {
              configurable: true,
              writable: true,
              value() {},
            });
        });
      await use(context);
    } finally {
      await browser.close();
    }
  },
  errors: [
    async ({ page, request }, use, testInfo) => {
      const identity = await (await request.get('/__lantern_identity')).json();
      expect(identity.root).toBe(await fs.realpath(projectRoot));
      expect(identity.assets).toBe(process.env.LANTERN_ASSET_SHA256);
      expect(identity.target).toBe(
        process.env.LANTERN_TEST_BUILT === 'true' ? 'built' : 'development',
      );
      const errors: string[] = [];
      const pending = new Set<string>();
      const warnings: string[] = [];
      const stages: { name: string; duration: number }[] = [];
      await page.addInitScript(() => {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (
              entry.name.startsWith('lantern-startup:') &&
              entry.name !== 'lantern-startup:image-decode'
            )
              console.debug(
                'lantern-startup-stage',
                JSON.stringify({ name: entry.name, duration: entry.duration }),
              );
        }).observe({ entryTypes: ['measure'] });
      });
      page.on('request', (request) => pending.add(request.url()));
      const finished = (request: { url(): string }) => pending.delete(request.url());
      page.on('requestfinished', finished);
      page.on('requestfailed', finished);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
        if (message.type() === 'warning') warnings.push(message.text());
        if (message.type() === 'debug' && message.text().startsWith('lantern-startup-stage '))
          stages.push(JSON.parse(message.text().slice('lantern-startup-stage '.length)));
      });
      await use(errors);
      if (testInfo.status !== testInfo.expectedStatus) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const state = await Promise.race([
          page
            .evaluate(() => ({
              status: document.querySelector('#status')?.textContent,
              startupError: document.querySelector('#startup-error-detail')?.textContent,
              ready: document.querySelector('canvas')?.getAttribute('data-ready'),
              stages: performance
                .getEntriesByType('measure')
                .filter(
                  (entry) =>
                    entry.name.startsWith('lantern-startup:') &&
                    entry.name !== 'lantern-startup:image-decode',
                )
                .map((entry) => ({ name: entry.name, duration: entry.duration })),
            }))
            .catch((error: Error) => ({ error: error.message })),
          new Promise((resolve) => {
            timer = setTimeout(
              () => resolve({ error: 'Renderer did not respond within 3s' }),
              3000,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        const diagnostic = {
          state,
          stages,
          pending: [...pending],
          warnings: warnings.slice(-10),
          errors,
        };
        console.log('Browser failure state:', JSON.stringify(diagnostic));
        await testInfo.attach('failure-state', {
          body: JSON.stringify(diagnostic, null, 2),
          contentType: 'application/json',
        });
      }
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
// Pixel assertions and renderer proofs always execute real draws at native resolution.
export const pixelTest = test.extend({ deviceScaleFactor: 1 });
// Explicit opt-in: these assertions own DOM/input/state, not rendered pixels.
export const stateTest = test.extend({
  rasterize: process.env.LANTERN_TEST_RASTERIZE === 'true',
  deviceScaleFactor: Object.keys(process.env).some((key) => /CAPTURE|CAPTURES/.test(key))
    ? 1
    : Number(process.env.LANTERN_TEST_SCALE ?? 0.25),
});
export { expect };

export async function activateWithKeyboard(button: Locator) {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.press('Enter');
}

export async function waitForEditor(page: Page, timeout = 180_000) {
  await page.waitForFunction(
    () => {
      const error = document.querySelector('#validation-errors')?.textContent;
      if (error?.includes('Editor startup failed:')) throw new Error(error);
      return window.sceneEditor?.ready();
    },
    undefined,
    { timeout },
  );
}
export async function openEditor(page: Page, url = '/editor.html?automated') {
  await page.goto(url);
  await waitForEditor(page);
}

export async function waitForEditorIdle(page: Page) {
  await expect(page.locator('#tool')).toBeEnabled({ timeout: 60_000 });
}

export function expectPageValue<T>(
  page: Page,
  read: () => T,
  options?: Parameters<typeof expect.poll>[1],
) {
  return expect.poll(() => page.evaluate(read), options);
}
