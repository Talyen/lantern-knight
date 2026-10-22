import { expectPageValue, stateTest as test, expect } from './fixtures';
// These interaction proofs do not depend on a full-size framebuffer.
test.use({ viewport: { width: 800, height: 600 } });

test('scene selection and distinct camera framing survive one workspace reload', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => sessionStorage.setItem('lantern-author-scene', 'court'));
  await page.goto('/sandbox.html');
  await page.waitForFunction(() => window.foundation?.ready);
  expect(await page.evaluate(() => window.foundation.sim.area)).toBe('outdoor-fixture');
  const select = async (scene: string) => {
    await page.locator('#scene-select').selectOption(scene);
    await page.waitForFunction(
      (id) => window.foundation?.ready && window.foundation.sim.area === id,
      scene,
    );
  };
  const frame = async (span: number) =>
    page.evaluate((span) => {
      const f = window.foundation;
      f.pause(true);
      f.mode('lighting');
      f.presentation.verticalSpan = span;
    }, span);
  await frame(13);
  await select('interior-fixture');
  await frame(17);
  // Drop URL selection and reconstruct both fixtures from the saved workspace.
  await page.goto('/sandbox.html');
  await page.waitForFunction(() => window.foundation?.ready);
  expect(await page.evaluate(() => window.foundation.sim.area)).toBe('interior-fixture');
  for (const [scene, span] of [
    ['interior-fixture', 17],
    ['outdoor-fixture', 13],
  ] as const) {
    if (scene === 'outdoor-fixture') await select(scene);
    expect(await page.evaluate(() => window.foundation.presentation.verticalSpan)).toBe(span);
    expect(
      await page.evaluate(() => {
        const { rig, look, sun } = window.foundation.presentation.lookRenderer.settings;
        return { rig, look, sun };
      }),
    ).toEqual({ rig: 'lantern', look: 'cinematic', sun: { azimuthDeg: 20, elevationDeg: 15 } });
  }
});

test('repeated scene switches release renderer resources', async ({ page }) => {
  // Warm the two fixtures, then compare two complete replacement cycles.
  test.setTimeout(300_000);
  await page.goto('/sandbox.html?scene=interior-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  const resources = await page.evaluate(async () => {
    const f = window.foundation;
    const samples = [];
    for (let i = 0; i < 3; i++) {
      await f.fixture('outdoor-fixture');
      await f.fixture('interior-fixture');
      f.presentation.update(f.sim, 1, 0, { x: 0, z: 1 });
      samples.push({ ...f.presentation.renderer.info.memory });
    }
    const room = f.presentation.roomPresentation.inkRoom!,
      sprite = room.sprites.find((s) => s.id === 'support')!;
    room.sceneryReveal.add(sprite);
    f.pause(true);
    f.editPreview((sim) => {
      sim.enemies.forEach((enemy) => {
        enemy.health = 0;
      });
      Object.assign(sim.hero, { x: -3, px: -3, z: -3.2, pz: -3.2 });
    });
    for (let i = 0; i < 30; i++) f.presentation.update(f.sim, 1, 1000 / 60, { x: 0, z: 1 });
    if (
      !(Number(sprite.mesh.userData.revealStrength) > 0.5) ||
      sprite.material.opacity !== 1 ||
      !sprite.material.depthWrite
    )
      throw new Error(
        'Interior cutout must reveal locally while retaining its opaque depth policy',
      );
    if (f.presentation.renderer.getContext().getError()) throw new Error('Renderer error');
    return samples;
  });
  expect(resources[2]).toEqual(resources[1]);
});

test('benchmark resets keep renderer generations aligned and restore the original content', async ({
  page,
}) => {
  // The reset and restore each prepare a complete renderer generation.
  test.setTimeout(420_000);
  await page.goto('/sandbox.html?scene=interior-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  const before = await page.evaluate(async () => {
    const f = window.foundation;
    f.pause(true);
    const save = f.saveValue();
    await f.startBenchmark();
    f.pause(true);
    const generation = f.sim.generation;
    f.editPreview((sim) => {
      sim.cleared = true;
    });
    f.pause(false);
    return { save, generation };
  });
  await page.waitForFunction((generation) => {
    const f = window.foundation;
    return f.sim.generation > generation && f.presentation.generation === f.sim.generation;
  }, before.generation);
  const restored = await page.evaluate(async () => {
    const f = window.foundation;
    f.pause(true);
    await f.finishBenchmark();
    return {
      save: f.saveValue(),
      generation: f.sim.generation,
      rendered: f.presentation.generation,
    };
  });
  expect(restored.save).toEqual(before.save);
  expect(restored.rendered).toBe(restored.generation);
});

test('preview navigation preserves playback and isolates controls from gameplay', async ({
  page,
}) => {
  await page.goto('/sandbox.html?scene=systems-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await expect(page.locator('#preview-drawer')).toBeHidden();
  await expect(page.locator('.hud')).toBeHidden();
  const bounds = await page.locator('canvas').boundingBox();
  expect(bounds?.height).toBe(page.viewportSize()!.height - 44);
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
  await page.bringToFront();
  await page.locator('canvas').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toHaveText('Pause');
  await expectPageValue(page, () => window.foundation.sim.tick, {
    timeout: 30_000,
  }).toBeGreaterThan(before.tick);
});

test('workspace reset requires confirmation and clears preview experiments', async ({ page }) => {
  await page.goto('/sandbox.html?scene=outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByRole('button', { name: 'Visuals', exact: true }).click();
  await page.selectOption('#lighting-rig', 'golden');
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
  await page.getByRole('button', { name: 'Visuals', exact: true }).click();
  await expect(page.locator('#lighting-rig')).toHaveValue('lantern');
});

test('shared asset browser includes library enemies, separates poses and filters references', async ({
  page,
}) => {
  await page.goto('/sandbox.html?scene=outdoor-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await expect(page.locator('#asset option[value="library-ct01"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(page.locator('#asset option[value="ink-stage-earth"]')).toHaveCount(0);
  await page.locator('#asset').selectOption('library-ct01');
  // Decode/upload can outlast the default 5 s assertion window on CI software rendering.
  await expectPageValue(page, () => window.foundation.presentation.labAsset, {
    timeout: 30_000,
  }).toBe('library-ct01');
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
  await expectPageValue(page, () => window.foundation.presentation.labAsset, {
    timeout: 30_000,
  }).toBe('ink-stage-earth');
  await expect(page.locator('#clip optgroup[label="Still poses"] option')).toHaveCount(1);
  expect(await page.evaluate(() => window.foundation.presentation.packs.has('library-ct01'))).toBe(
    false,
  );
  await page.locator('#asset-search').fill('library-loot_pickup');
  await expect(page.locator('#asset option')).toHaveCount(1);
  await page.locator('#asset').selectOption('library-loot_pickup');
  await expectPageValue(page, () => window.foundation.presentation.labAsset, {
    timeout: 30_000,
  }).toBe('library-loot_pickup');
});
