import type { Page } from '@playwright/test';

export async function holdMovement(page: Page, key: string) {
  await page.locator('canvas').focus();
  await page.keyboard.down(key);
  try {
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  } finally {
    await page.keyboard.up(key);
  }
}
