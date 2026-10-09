import { test, expect } from './fixtures';
test('game input, pause focus and current checkpoint reload', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  expect(await page.evaluate(() => 'foundation' in window)).toBe(false);
  await page.locator('#pause').click();
  await expect(page.locator('#resume')).toBeFocused();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.endsWith('-game')),
  );
  expect(keys.length).toBe(1);
  const initial = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), keys[0]!);
  expect(initial.area).toBe('empty');
  expect(initial.areas.empty.actors).toEqual({});
  expect(initial.wins).toBe(0);
  await expect(page.locator('#objective')).toHaveText('Explore the scene');
  await page.locator('#resume').click();
  await page.locator('canvas').focus();
  await page.keyboard.down('KeyW');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let count = 0;
        const frame = () => {
          if (++count === 10) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
  await page.keyboard.up('KeyW');
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const moved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), keys[0]!);
  expect(
    Math.hypot(moved.player.x - initial.player.x, moved.player.z - initial.player.z),
  ).toBeGreaterThan(0.03);
  await page.locator('#load').click();
  await expect(page.locator('#status')).toContainText('loaded', { ignoreCase: true });
  await page.locator('#pause').click();
  await page.locator('#new-game').click();
  await expect(page.locator('#cancel-new')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-confirm')).not.toBeVisible();
  await expect(page.locator('#modal')).toBeVisible();
});
