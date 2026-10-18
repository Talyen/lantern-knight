import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { test, expect } from './fixtures';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import type { GameSave } from '../../src/core/save';

test('campfire improvements save atomically, remain independent and work in different scenes', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const area = content.area('forest-gathering-clearing');
  const fire = area.campfires![0]!;
  const session = new GameSession(content, 142, area.id);
  Object.assign(session.sim.hero, { x: fire.x, z: fire.z });
  session.discoverFire(area.id + '/' + fire.id);
  const save = session.captureSave();
  save.player.health = 60;
  delete save.adventure!.pack;
  Object.assign(save.adventure!.inventory, { gold: 40, iron: 8 });
  for (const actor of Object.values(save.areas[area.id]!.actors)) actor.health = 0;
  save.areas[area.id]!.cleared = true;
  const profile = process.env.LANTERN_TEST_BUILT === 'true' ? 'game' : 'preview';
  const key = `lantern-prototype-${profile}-game`;
  await page.addInitScript(
    ({ key, save }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
    },
    { key, save },
  );
  const stored = (): Promise<GameSave> =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  const ready = async () => {
    await page.waitForFunction(
      () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
      undefined,
      { timeout: 180_000 },
    );
    await expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: 60_000 });
  };
  const capture = async (name: string) => {
    const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await expect(page.locator('.adventure-panel .item-art:not([data-ready="true"])')).toHaveCount(
      0,
      { timeout: 60_000 },
    );
    await page.screenshot({ path: path.join(directory, `campfire-upgrade-${name}.png`) });
  };
  await page.goto('/index.html?automated');
  await ready();
  await page.locator('#menu-start').click();
  // Inventory is an inspection surface even when the hero happens to stand at a fire.
  await page.keyboard.press('i');
  await page.getByRole('button', { name: 'Upgrade kit', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Upgrade kit', exact: true });
  const confirm = panel.locator('[data-action="confirm-upgrade"]');
  await expect(confirm).toBeDisabled();
  await expect(panel).toContainText('Visit any campfire to purchase.');
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  await capture('campfire');
  await page.getByRole('button', { name: 'Upgrade kit', exact: true }).click();
  const sword = panel.getByRole('button', { name: 'Temper Sword I', exact: true });
  const lantern = panel.getByRole('button', { name: 'Rekindle Lantern I', exact: true });
  await expect(panel.locator('.upgrade-damage')).toContainText('26 → 52');
  await lantern.click();
  await expect(panel.locator('.upgrade-damage')).toContainText('28 → 56');
  await sword.click();
  await capture('wide');
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(sword).toBeInViewport({ ratio: 1 });
  await expect(lantern).toBeInViewport({ ratio: 1 });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await capture('narrow');
  await page.setViewportSize({ width: 1280, height: 800 });
  const before = await stored();
  await page.evaluate(() => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')!.value as (
      this: Storage,
      key: string,
      value: string,
    ) => void;
    Storage.prototype.setItem = function (key, value) {
      if (key.endsWith('-game')) throw new Error('Storage full');
      original.call(this, key, value);
    };
    Object.assign(window, {
      restoreUpgradeStorage: () => {
        Storage.prototype.setItem = original;
      },
    });
  });
  await confirm.click();
  await expect(panel.getByRole('alert')).toContainText('Nothing was spent');
  expect((await stored()).adventure).toEqual(before.adventure);
  await page.evaluate(() =>
    (window as unknown as { restoreUpgradeStorage(): void }).restoreUpgradeStorage(),
  );
  await confirm.focus();
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(confirm).toHaveText('Complete');
  const first = await stored();
  expect(first.adventure!.upgrades).toEqual({ sword: 1 });
  expect(first.adventure!.inventory.gold).toBe(20);
  expect(first.adventure!.inventory.iron).toBe(4);
  expect(first.player.health).toBe(60);
  expect(first.areas[area.id]!.actors).toEqual(before.areas[area.id]!.actors);
  await expect(lantern).toBeEnabled();
  await lantern.click();
  await expect(confirm).toBeEnabled();
  // Returning from inspection neither rests nor buys the other path.
  await panel.getByRole('button', { name: 'Back to campfire', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rest', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  const chapel = content.area('desecrated-chapel');
  const other = chapel.campfires![0]!;
  const destination = new GameSession(content, 142, chapel.id);
  Object.assign(destination.sim.hero, { x: other.x, z: other.z });
  destination.discoverFire(chapel.id + '/' + other.id);
  const next = destination.captureSave();
  next.adventure = {
    ...first.adventure!,
    discovered: [...first.adventure!.discovered, chapel.id + '/' + other.id],
    lastFire: chapel.id + '/' + other.id,
  };
  next.player.health = 60;
  await page.evaluate(({ key, next }) => localStorage.setItem(key, JSON.stringify(next)), {
    key,
    next,
  });
  await page.reload();
  await ready();
  await page.locator('#menu-start').click();
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Upgrade kit', exact: true }).click();
  await lantern.click();
  await confirm.click();
  await expect(confirm).toHaveText('Complete');
  const both = await stored();
  expect(both.adventure!.upgrades).toEqual({ sword: 1, lantern: 1 });
  expect(both.adventure!.inventory.gold).toBe(0);
  expect(both.adventure!.inventory.iron).toBe(0);
  expect(both.player.health).toBe(60);
  await sword.click();
  await expect(confirm).toBeDisabled();
  await capture('both');
  await page.keyboard.press('Escape');
  await page.reload();
  await ready();
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  await page.locator('[data-action="slot-sword"]').click();
  await expect(page.locator('.inventory-detail')).toContainText('Damage 52');
  await page.locator('[data-action="slot-lantern"]').click();
  await expect(page.locator('.inventory-detail')).toContainText('Damage 56 per enemy');
});
