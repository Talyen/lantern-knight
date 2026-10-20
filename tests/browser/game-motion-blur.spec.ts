import { stateTest as test, expect } from './fixtures';

test('audio and graphics settings persist independently through one player reload', async ({
  page,
}) => {
  // Both cold Game starts and the settings round trip render through software WebGL in CI.
  test.setTimeout(300_000);
  await page.goto('/index.html');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-settings').click();
  await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await expect(page.locator('[data-audio="master"]')).toHaveValue('80');
  await page.locator('[data-audio="master"]').evaluate((element: HTMLInputElement) => {
    element.value = '35';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('[data-audio="muted"]').check();
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
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
  await page.getByRole('tab', { name: 'Sound', exact: true }).click();
  await expect(page.locator('[data-audio="master"]')).toHaveValue('35');
  await expect(page.locator('[data-audio="muted"]')).toBeChecked();
});
