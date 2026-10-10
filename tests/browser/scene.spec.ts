import { test, expect } from './fixtures';
import type {} from '../../src/inspection';
for (const scene of ['outdoor-fixture', 'interior-fixture'])
  test(`scene ${scene}: readiness, reload and resource lifetime`, async ({ page }) => {
    // Eight fixture switches plus reload exercise software rendering on CI.
    test.setTimeout(180_000);
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

test('preview selection uses its current workspace and rejects removed URL fixtures', async ({
  page,
}) => {
  // Four scene loads exercise selection precedence under CI software rendering.
  test.setTimeout(120_000);
  await page.addInitScript(() => sessionStorage.setItem('lantern-author-scene', 'court'));
  await page.goto('/sandbox.html');
  await page.waitForFunction(() => window.foundation?.ready);
  expect(await page.evaluate(() => window.foundation.sim.area)).toBe('outdoor-fixture');
  await page.locator('#scene-select').selectOption('interior-fixture');
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.sim.area === 'interior-fixture',
  );
  await page.goto('/sandbox.html');
  await page.waitForFunction(() => window.foundation?.ready);
  expect(await page.evaluate(() => window.foundation.sim.area)).toBe('interior-fixture');
  await page.goto('/sandbox.html?scene=upper-landing');
  await page.waitForFunction(() => window.foundation?.ready);
  expect(await page.evaluate(() => window.foundation.sim.area)).toBe('outdoor-fixture');
});

test('preview navigation preserves playback and isolates controls from gameplay', async ({
  page,
}) => {
  await page.goto('/sandbox.html?scene=systems-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await expect(page.locator('#preview-drawer')).toBeHidden();
  await expect(page.locator('.hud')).toBeHidden();
  const bounds = await page.locator('canvas').boundingBox();
  expect(bounds?.height).toBe(756);
  await page.locator('#pause').click();
  const before = await page.evaluate(() => ({
    tick: window.foundation.sim.tick,
    hero: { x: window.foundation.sim.hero.x, z: window.foundation.sim.hero.z },
    look: window.foundation.presentation.lightingLab.settings,
  }));
  await page.getByRole('button', { name: 'Visuals', exact: true }).click();
  await page.selectOption('#lighting-rig', 'silver');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  expect(await page.evaluate(() => window.foundation.sim.tick)).toBe(before.tick);
  expect(await page.evaluate(() => window.foundation.presentation.lightingLab.settings.rig)).toBe(
    'silver',
  );
  await page.locator('#zoom-span').focus();
  await page.keyboard.press('w');
  await page.keyboard.press('Shift');
  await page.keyboard.press('Escape');
  await expect(page.locator('#preview-drawer')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Inspect', exact: true })).toBeFocused();
  expect(
    await page.evaluate(() => ({
      x: window.foundation.sim.hero.x,
      z: window.foundation.sim.hero.z,
    })),
  ).toEqual(before.hero);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.setViewportSize({ width: 480, height: 720 });
  await page.getByText('View & registration', { exact: true }).click();
  const span = await page.evaluate(() => window.foundation.presentation.viewSpan);
  await page.locator('#lab-zoom').evaluate((input: HTMLInputElement) => {
    input.value = '100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(await page.evaluate(() => window.foundation.presentation.viewSpan)).toBeCloseTo(span * 2);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#return-scene').click();
  expect(await page.evaluate(() => window.foundation.sim.tick)).toBe(before.tick);
  expect(await page.evaluate(() => window.foundation.presentation.lightingLab.settings.rig)).toBe(
    'silver',
  );
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await page.getByText('Scale & calibration', { exact: true }).click();
  await page.locator('#calibration-toggle').click();
  expect(await page.evaluate(() => window.foundation.presentation.mode)).toBe('calibration');
  await page.locator('#calibration-toggle').click();
  expect(await page.evaluate(() => window.foundation.sim.tick)).toBe(before.tick);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.locator('#preview-hud').check();
  await expect(page.locator('.hud')).toBeVisible();
  await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
  await expect(page.locator('.preview-toolbar')).toBeHidden();
  expect((await page.locator('canvas').boundingBox())?.height).toBe(800);
  await page.keyboard.press('Escape');
  await expect(page.locator('.preview-toolbar')).toBeVisible();
  await page.locator('canvas').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toHaveText('Pause');
  await expect
    .poll(() => page.evaluate(() => window.foundation.sim.tick))
    .toBeGreaterThan(before.tick);
});

test('preview scene reset preserves experiments; settings reset and workspace reset are explicit', async ({
  page,
}) => {
  // This journey rebuilds the preview through several full-page resets.
  test.setTimeout(180_000);
  await page.goto('/sandbox.html?scene=outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByRole('button', { name: 'Visuals', exact: true }).click();
  await page.selectOption('#lighting-rig', 'silver');
  await page.locator('#reset').click();
  await expect(page.locator('#lighting-rig')).toHaveValue('silver');
  await page.selectOption('#scene-select', 'interior-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await expect(page.locator('#lighting-rig')).toHaveValue('golden');
  await page.selectOption('#scene-select', 'outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await expect(page.locator('#lighting-rig')).toHaveValue('silver');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Reset scene settings', exact: true }).click();
  await page.waitForFunction(() => window.foundation?.ready);
  await expect(page.locator('#lighting-rig')).toHaveValue('golden');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Reset workspace…', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#preview-drawer')).toBeVisible();
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Reset workspace…', exact: true }).click();
  await page.getByRole('button', { name: 'Reset workspace', exact: true }).click();
  await page.waitForFunction(() => window.foundation?.ready);
  await expect(page.locator('#preview-drawer')).toBeHidden();
  await expect(page.locator('.hud')).toBeHidden();
});

test('shared asset browser includes library enemies, separates poses and filters references', async ({
  page,
}) => {
  await page.goto('/sandbox.html?scene=outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect(page.locator('#asset option[value="library-ct01"]')).toHaveCount(1);
  await expect(page.locator('#asset option[value="ink-stage-earth"]')).toHaveCount(0);
  await page.locator('#asset').selectOption('library-ct01');
  // Decode/upload can outlast the default 5 s assertion window on CI software rendering.
  await expect
    .poll(() => page.evaluate(() => window.foundation.presentation.labAsset), { timeout: 30_000 })
    .toBe('library-ct01');
  expect(
    await page.evaluate(() => {
      const p = window.foundation.presentation;
      return p.camera.top - p.camera.bottom - p.viewSpan;
    }),
  ).toBeCloseTo(0);
  await expect(page.locator('#visual-time')).toContainText('drawings');
  expect(await page.evaluate(() => window.foundation.presentation.secondSprite.mesh.visible)).toBe(
    false,
  );
  expect(await page.evaluate(() => window.foundation.presentation.sceneEffects.group.visible)).toBe(
    false,
  );
  await page.getByText('Asset filters', { exact: true }).click();
  await page.locator('#asset-scope').selectOption('used');
  await expect(page.locator('#asset option[value="library-ct01"]')).toHaveCount(0);
  await page.locator('#asset-scope').selectOption('all');
  await page.locator('#asset-animated').uncheck();
  await expect(page.locator('#asset option[value="ink-stage-earth"]')).toHaveCount(1);
  await page.locator('#asset').selectOption('ink-stage-earth');
  await expect
    .poll(() => page.evaluate(() => window.foundation.presentation.labAsset), { timeout: 30_000 })
    .toBe('ink-stage-earth');
  await expect(page.locator('#clip optgroup[label="Still poses"] option')).toHaveCount(1);
  expect(await page.evaluate(() => window.foundation.presentation.packs.has('library-ct01'))).toBe(
    false,
  );
  await page.locator('#asset-search').fill('library-loot_pickup');
  await expect(page.locator('#asset option')).toHaveCount(1);
  await page.locator('#asset').selectOption('library-loot_pickup');
  await expect
    .poll(() => page.evaluate(() => window.foundation.presentation.labAsset), { timeout: 30_000 })
    .toBe('library-loot_pickup');
});
