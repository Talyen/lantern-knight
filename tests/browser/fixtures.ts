import { test as base, expect, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { projectRoot } from '../../tools/assets/paths';
export const test = base.extend<{ errors: string[] }>({
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
      // Retire live render loops before destroying the context. Software WebGL
      // can otherwise keep Chromium busy while the next context is created.
      if (testInfo.status === testInfo.expectedStatus && !page.isClosed())
        await page.goto('about:blank', { waitUntil: 'load', timeout: 30_000 });
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
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
