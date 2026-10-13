import { test, expect } from './fixtures';
test('Dev Preview remembers separate scene experiments and preserves comparison selections', async ({
  page,
}) => {
  await page.goto('/effects.html');
  await expect(page).toHaveURL(/sandbox.html/);
  await page.waitForFunction(() => window.effectsPlayground?.ready);
  await page.getByRole('button', { name: 'Visuals', exact: true }).click();
  await page.getByText('Individual effects', { exact: true }).click();
  await page.locator('[data-effect="rain"]').uncheck();
  await page.locator('#baseline').check();
  expect(await page.evaluate(() => window.effectsPlayground.settings.effects.rain)).toBe(false);
  const reset = await page.evaluate(async () => {
    const effects = window.effectsPlayground;
    effects.pause(true);
    effects.step(400);
    // Draw the selected settings and animation frame before measuring reset's resources.
    const objects = effects.stats().objects;
    await effects.reset();
    effects.render();
    return { before: objects, after: effects.stats().objects, time: effects.stats().time };
  });
  expect(reset.after).toEqual(reset.before);
  expect(reset.time).toBe(0);
  expect(await page.evaluate(() => window.effectsPlayground.settings.paused)).toBe(true);
  await page.selectOption('#scene-select', 'outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByText('Individual effects', { exact: true }).click();
  await page.locator('[data-scene-effect="rain"]').uncheck();
  await page.locator('#scene-baseline').check();
  await page.locator('#scene-baseline').uncheck();
  expect(await page.evaluate(() => window.foundation.presentation.visualEffects.rain)).toBe(false);
  await page.selectOption('#scene-select', 'effects-playground');
  await page.waitForFunction(() => window.effectsPlayground?.ready);
  await expect(page.locator('#baseline')).toBeChecked();
  expect(await page.evaluate(() => window.effectsPlayground.settings.paused)).toBe(true);
  await expect(page.locator('[data-effect="rain"]')).not.toBeChecked();
  await page.locator('#baseline').uncheck();
  expect(await page.evaluate(() => window.effectsPlayground.settings.effects.rain)).toBe(false);
  await page.reload();
  await page.waitForFunction(() => window.effectsPlayground?.ready);
  await expect(page.locator('[data-effect="rain"]')).not.toBeChecked();
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect(page.getByText('Animation requires Outdoor, Interior or Systems.')).toBeVisible();
  expect(await page.locator('#scene-select').inputValue()).toBe('effects-playground');
  await page.selectOption('#scene-select', 'interior-fixture');
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.sim.area === 'interior-fixture',
  );
  await page.getByRole('button', { name: 'Visuals', exact: true }).click();
  await expect(page.locator('[data-scene-effect="rain"]')).toBeChecked();
});
