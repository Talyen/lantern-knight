import { test, expect } from './fixtures';
test('effects playground starts using prepared resources', async ({ page }) => {
  await page.goto('/effects.html');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#status')).not.toContainText('failed');
  await expect.poll(() => page.locator('#status').textContent()).not.toMatch(/Loading/i);
});
