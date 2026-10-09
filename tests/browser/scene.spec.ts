import { test, expect } from './fixtures';
import type {} from '../../src/inspection';
for (const scene of ['court', 'upper-landing'])
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
    await page.evaluate(async () => {
      const f = window.foundation;
      await f.fixture('court');
      await f.fixture('upper-landing');
      f.presentation.update(f.sim, 1, 0, { x: 0, z: 1 });
      if (f.presentation.renderer.getContext().getError()) throw new Error('Renderer error');
    });
  });
