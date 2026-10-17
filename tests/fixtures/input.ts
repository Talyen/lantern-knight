import { expect, type Page } from '@playwright/test';

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

// Loading replaces renderer resources before the player receives completion feedback.
export async function loadCheckpoint(page: Page) {
  await clickCheckpointAction(page, 'load');
  await expect(page.locator('#status')).toHaveText('Checkpoint loaded', { timeout: 120_000 });
}

export async function clickCheckpointAction(
  page: Page,
  action: 'save' | 'load' | 'reset' | 'new-game',
) {
  const button = page.locator('#' + action);
  if (!(await button.isVisible())) await page.locator('#checkpoint-options > summary').click();
  await button.click();
}
