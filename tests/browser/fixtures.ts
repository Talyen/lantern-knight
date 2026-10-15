import { test as base, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { projectRoot } from '../../tools/assets/paths';
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page, request }, use) => {
      const identity = await (await request.get('/__lantern_identity')).json();
      expect(identity.root).toBe(await fs.realpath(projectRoot));
      expect(identity.assets).toBe(process.env.LANTERN_ASSET_SHA256);
      expect(identity.target).toBe(
        process.env.LANTERN_TEST_BUILT === 'true' ? 'built' : 'development',
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function waitForEditor(page: Page, timeout?: number) {
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
