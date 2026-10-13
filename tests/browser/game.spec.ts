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
  await expect(page.locator('canvas')).toBeFocused();
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
  await expect(page.locator('#status')).toContainText('loaded', { ignoreCase: true });
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
  await expect
    .poll(() =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).player.health, keys[0]!),
    )
    .toBe(100);
  await expect(page.locator('#objective')).toHaveText('Explore the scene');
  await page.locator('#pause').click();
  await page.locator('#new-game').click();
  await expect(page.locator('#cancel-new')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#new-confirm')).not.toBeVisible();
  await expect(page.locator('#modal')).toBeVisible();
});
