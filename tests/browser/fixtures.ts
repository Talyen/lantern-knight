import { test as base, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { projectRoot } from '../../tools/assets/paths';
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page, request }, use) => {
      const identity = await (await request.get('/__lantern_identity')).json();
      expect(identity.root).toBe(await fs.realpath(projectRoot));
      expect(identity.assets).toBe(process.env.LANTERN_ASSET_SHA256);
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
