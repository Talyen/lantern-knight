import { test, expect } from './fixtures';
test('combined authoring surface switches scenes, isolates controls and preserves effects experiments', async ({
  page,
}) => {
  await page.goto('/effects.html');
  await expect(page).toHaveURL(/sandbox.html/);
  await page.waitForFunction(() => window.effectsPlayground?.ready);
  await page.locator('#baseline').check();
  await expect
    .poll(() => page.evaluate(() => window.effectsPlayground.settings.baseline))
    .toBe(true);
  await page.locator('#scene-select').selectOption('outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByRole('button', { name: 'Lighting & Look', exact: true }).click();
  const effect = page.locator('[data-scene-effect="rain"]');
  await effect.uncheck();
  await expect
    .poll(() => page.evaluate(() => window.foundation.presentation.visualEffects.rain))
    .toBe(false);
  await page.locator('#scene-select').selectOption('effects-playground');
  await page.waitForFunction(() => window.effectsPlayground?.ready);
  await expect(page.locator('#baseline')).not.toBeChecked();
  await page.locator('#scene-select').selectOption('interior-fixture');
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.sim.area === 'interior-fixture',
  );
  await expect(page.locator('body')).not.toHaveClass(/effects-mode/);
});
