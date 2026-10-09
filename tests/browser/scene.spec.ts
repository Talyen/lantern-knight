import { test, expect } from './fixtures';
import type {} from '../../src/inspection';
for (const scene of ['outdoor-fixture', 'interior-fixture'])
  test(`scene ${scene}: readiness, reload and resource lifetime`, async ({ page }) => {
    await page.goto('/sandbox.html?scene=' + scene);
    await page.waitForFunction(() => window.foundation?.ready);
    expect(await page.evaluate(() => window.foundation.sim.area)).toBe(scene);
    await page.evaluate(() => {
      const f = window.foundation;
      f.pause(true);
      f.mode('lighting');
      f.presentation.verticalSpan = 13;
    });
    await page.reload();
    await page.waitForFunction(() => window.foundation?.ready);
    expect(await page.evaluate(() => window.foundation.sim.area)).toBe(scene);
    expect(await page.evaluate(() => window.foundation.presentation.verticalSpan)).toBe(13);
    const resources = await page.evaluate(async () => {
      const f = window.foundation;
      const samples = [];
      for (let i = 0; i < 4; i++) {
        await f.fixture('outdoor-fixture');
        await f.fixture('interior-fixture');
        f.presentation.update(f.sim, 1, 0, { x: 0, z: 1 });
        samples.push({ ...f.presentation.renderer.info.memory });
      }
      if (f.presentation.renderer.getContext().getError()) throw new Error('Renderer error');
      return samples;
    });
    expect(resources[3]).toEqual(resources[2]);
  });

test('removed scene selections fall back to a valid developer fixture', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('lantern-author-scene', 'court'));
  await page.goto('/sandbox.html');
  await page.waitForFunction(() => window.foundation?.ready);
  expect(await page.evaluate(() => window.foundation.sim.area)).toBe('outdoor-fixture');
  await page.goto('/sandbox.html?scene=upper-landing');
  await page.waitForFunction(() => window.foundation?.ready);
  expect(await page.evaluate(() => window.foundation.sim.area)).toBe('outdoor-fixture');
});
