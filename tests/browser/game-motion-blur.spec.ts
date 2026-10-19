import { test, expect } from './fixtures';

test('camera motion blur is opt-in and persists through player settings reload', async ({
  page,
}) => {
  // Both cold Game starts and the settings round trip render through software WebGL in CI.
  test.setTimeout(300_000);
  await page.goto('/index.html');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-settings').click();
  await page.locator('.advanced-settings > summary').click();
  const blur = page.getByRole('checkbox', {
    name: 'Camera motion blur (experimental)',
    exact: true,
  });
  await expect(blur).not.toBeChecked();
  await blur.check();
  // Save is asynchronous; leaving settings must retain the accepted preference.
  await page.locator('#menu-back').click();
  await page.locator('#menu-start').click();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await page.locator('#menu-settings').click();
  await expect(blur).toBeChecked();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-settings').click();
  await page.locator('.advanced-settings > summary').click();
  await expect(blur).toBeChecked();
  await blur.uncheck();
});
