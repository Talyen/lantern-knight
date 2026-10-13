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
  expect(initial.area).toBe('abandoned-orchard');
  expect(Object.values(initial.areas[initial.area].actors).every((a: any) => a.health > 0)).toBe(
    true,
  );
  expect(initial.wins).toBe(0);
  await expect(page.locator('#objective')).toHaveText('');
  await page.locator('#resume').click();
  await expect(page.locator('.game-stage canvas')).toBeFocused();
  const inputErrors: string[] = [];
  page.on('pageerror', (error) => inputErrors.push(error.message));
  await page.evaluate(async () => {
    const canvas = document.querySelector('canvas')!;
    const button = document.createElement('button');
    const child = document.createElement('span');
    child.tabIndex = 0;
    button.append(child);
    document.body.append(button);
    try {
      child.focus();
      child.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyW' }));
      for (let i = 0; i < 10; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      child.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyW' }));
      canvas.focus();
      for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            code: 'KeyW',
            [modifier]: true,
          }),
        );
        for (const button of [0, 2])
          canvas.dispatchEvent(
            new PointerEvent('pointerdown', {
              bubbles: true,
              button,
              clientX: 200,
              clientY: 200,
              [modifier]: true,
            }),
          );
        for (let i = 0; i < 3; i++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        canvas.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, code: 'KeyW' }));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyZ' }));
    } finally {
      button.remove();
    }
  });
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const afterControls = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    keys[0]!,
  );
  expect(afterControls.player).toEqual(initial.player);
  expect(inputErrors).toEqual([]);
  await page.locator('#resume').click();
  await expect(page.locator('canvas')).toBeFocused();
  await page.keyboard.down('KeyW');
  await page.evaluate(async () => {
    for (let i = 0; i < 10; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await page.keyboard.up('KeyW');
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const moved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), keys[0]!);
  expect(
    Math.hypot(moved.player.x - initial.player.x, moved.player.z - initial.player.z),
  ).toBeGreaterThan(0.03);
  await page.locator('#load').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('canvas')).toBeFocused();
  // A restored dead player immediately requests recovery through the real renderer.
  await page.evaluate(
    ({ key, save }) => {
      save.player.health = 0;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key: keys[0]!, save: moved },
  );
  await page.locator('#pause').click();
  await page.locator('#load').click();
  // The previous HUD may already show full health while load/recovery is pending.
  // Observe its committed checkpoint using the same budget as room acceptance.
  await expect
    .poll(
      () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).player.health, keys[0]!),
      { timeout: 60_000 },
    )
    .toBe(100);
  await expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: 60_000 });
  await expect(page.locator('#hp')).toHaveText('100 / 100');
  await expect(page.locator('#objective')).toHaveText('');
  await page.locator('#pause').click();
  await page.locator('#new-game').click();
  await expect(page.locator('#cancel-new')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-confirm')).not.toBeVisible();
  await expect(page.locator('#modal')).toBeVisible();
});

test('orchard loot, equipment, campfire rest and destination travel survive reload', async ({
  page,
}) => {
  // This full journey includes several renderer replacements and a final reload.
  test.setTimeout(300_000);
  const waitForRoom = () =>
    expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: 60_000 });
  // Targeted checkpoint setup exercises the actual renderer and UI without replaying combat in every browser run.
  await page.goto('/index.html?automated');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    undefined,
    { timeout: 180000 },
  );
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const { content } = await import('../../src/content/game-content');
  const orchard = content.area('abandoned-orchard');
  const chest = orchard.interactables!.find((o) => o.kind === 'container')!;
  const key = await page.evaluate(() =>
    Object.keys(localStorage).find((k) => k.endsWith('-game'))!,
  );
  await page.evaluate(
    ({ key, chest }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = chest.x;
      save.player.z = chest.z;
      save.player.health = 60;
      for (const a of Object.values(save.areas[save.area].actors) as { health: number }[])
        a.health = 0;
      save.areas[save.area].cleared = true;
      save.adventure.inventory['damaged-axe'] = 1;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key, chest: { x: chest.x, z: chest.z } },
  );
  await page.locator('#load').click();
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('#interaction-hint')).toContainText('Open container');
  await page.keyboard.press('e');
  await expect(page.locator('#interaction-hint')).toContainText('Collect');
  await page.keyboard.press('e');
  await page.keyboard.press('i');
  const panel = page.locator('.adventure-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Equip · Ring 1', exact: true }).click();
  await expect(panel).toContainText('60 / 110 health');
  const salvage = panel.getByRole('button', { name: 'Salvage stack' });
  await salvage.focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(panel).toContainText('Body · Leather / Cloth: Leather Armor');
  await expect(panel).toContainText('Iron ×2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('q');
  await expect(page.locator('#hp')).toHaveText('100 / 110');
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const fire = orchard.campfires![0]!;
  await page.evaluate(
    ({ key, fire }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = fire.x + 0.8;
      save.player.z = fire.z;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key, fire: { x: fire.x, z: fire.z } },
  );
  await page.locator('#load').click();
  await waitForRoom();
  await expect(page.locator('#interaction-hint')).toContainText('Orchard Campfire');
  await page.keyboard.press('e');
  await expect(panel).toContainText('Orchard Campfire');
  await panel.getByRole('button', { name: 'Rest', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Rested · health restored', { timeout: 60_000 });
  await expect(page.locator('#hp')).toHaveText('110 / 110');
  await waitForRoom();
  await page.keyboard.press('Escape');
  // Unlock departure through a valid cleared encounter checkpoint; use the real departure interaction.
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const exit = orchard.exits[0]!;
  await page.evaluate(
    ({ key, marker }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = marker.x;
      save.player.z = marker.z;
      for (const a of Object.values(save.areas[save.area].actors) as { health: number }[])
        a.health = 0;
      save.areas[save.area].cleared = true;
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key, marker: exit.marker },
  );
  await page.locator('#load').click();
  await waitForRoom();
  await expect(page.locator('#interaction-hint')).toContainText(
    'Travel to Forest Gathering Clearing',
  );
  await page.keyboard.press('e');
  await waitForRoom();
  await expect(page.locator('#room-title')).toHaveText('Forest Gathering Clearing');
  await page.keyboard.press('e');
  await expect(panel).toContainText('Clearing Campfire');
  await panel.getByRole('button', { name: 'Abandoned Orchard · Orchard Campfire' }).click();
  await waitForRoom();
  await expect(page.locator('#room-title')).toHaveText('Abandoned Orchard');
  await panel
    .getByRole('button', { name: 'Forest Gathering Clearing · Clearing Campfire' })
    .click();
  await waitForRoom();
  await expect(page.locator('#room-title')).toHaveText('Forest Gathering Clearing');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    undefined,
    { timeout: 180000 },
  );
  await expect(page.locator('#hp')).toHaveText('110 / 110');
});
