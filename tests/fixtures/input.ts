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
  await checkpointFeedback(page, 'load', 'Checkpoint loaded');
}

export async function saveCheckpoint(page: Page) {
  await checkpointFeedback(page, 'save', 'Checkpoint saved');
}

async function checkpointFeedback(page: Page, action: 'save' | 'load', message: string) {
  const status = page.locator('#status');
  // Software rendering can delay the next poll until a brief notice has cleared.
  // Arm before the action and retain proof that its completion feedback appeared.
  await status.evaluate((node, message) => {
    node.removeAttribute('data-checkpoint-feedback');
    const observer = new MutationObserver(() => {
      if (node.textContent !== message) return;
      node.setAttribute('data-checkpoint-feedback', message);
      observer.disconnect();
    });
    observer.observe(node, { childList: true, characterData: true, subtree: true });
  }, message);
  await clickCheckpointAction(page, action);
  await expect(status).toHaveAttribute('data-checkpoint-feedback', message, { timeout: 120_000 });
}

export async function clickCheckpointAction(
  page: Page,
  action: 'save' | 'load' | 'reset' | 'new-game',
) {
  const button = page.locator('#' + action);
  if (!(await button.isVisible())) await page.locator('#checkpoint-options > summary').click();
  await button.click();
}
