import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';

test('inventory compares replacements and forge keeps the choice and confirmation reachable', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const area = content.area('ruined-forge');
  const bench = area.interactables!.find((object) => object.kind === 'workbench')!;
  const session = new GameSession(content, 142, area.id);
  const save = session.captureSave();
  Object.assign(save.player, { x: bench.x, z: bench.z, health: 60 });
  for (const actor of Object.values(save.areas[area.id]!.actors)) actor.health = 0;
  save.areas[area.id]!.cleared = true;
  Object.assign(save.adventure!.inventory, {
    gold: 24,
    iron: 5,
    bone: 2,
    'health-potion': 2,
    'workshop-temper': 1,
    'orchard-ring': 2,
    'travellers-charm': 1,
    'gatherers-seal': 1,
    'damaged-axe': 2,
    'damaged-helmet': 1,
  });
  await page.addInitScript((save) => {
    const key = 'lantern-prototype-game-game';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
  }, save);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/index.html?automated');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  const panel = page.getByRole('dialog', { name: 'Inventory', exact: true });
  const detail = panel.getByRole('region', { name: 'Selected item' });
  const pick = (name: string) => panel.locator('.inventory-row').filter({ hasText: name }).click();
  const capture = async (name: string) => {
    const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await expect(page.locator('.adventure-panel .item-art:not([data-ready="true"])')).toHaveCount(
      0,
    );
    await page.screenshot({ path: path.join(directory, `redesign-${name}.png`) });
  };
  await panel.locator('[data-action="slot-sword"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.locator('[data-action="slot-body"]')).toBeFocused();
  await panel.locator('[data-action="slot-lantern"]').click();
  await expect(detail).toContainText('Damage 28 per enemy');
  await page.keyboard.press('Tab');
  await expect(panel.locator('.inventory-row').first()).toBeFocused();
  await pick('Traveller’s Charm');
  await expect(detail).toContainText('100 → 105');
  await detail.getByRole('button', { name: 'Equip', exact: true }).click();
  await expect(page.locator('#hp')).toHaveText('60 / 105');
  await expect(panel.locator('.inventory-slot[aria-pressed="true"]')).toBeFocused();
  await pick('Gatherer’s Seal');
  await expect(detail).toContainText('105 → 110');
  await expect(detail).toContainText('Replaces Traveller’s Charm');
  await expect(panel.locator('.item-art:not([data-ready="true"])')).toHaveCount(0);
  await expect(panel).not.toContainText('Ready for the road');
  await expect(panel).not.toContainText('The world waits');
  await capture('inventory-1280');
  await detail.getByRole('button', { name: 'Equip', exact: true }).click();
  await pick('Orchard Ring');
  await expect(detail).toContainText('110 → 120');
  await detail.getByRole('button', { name: 'Equip', exact: true }).click();
  await pick('Orchard Ring');
  await expect(detail.getByRole('combobox', { name: 'Equip to' })).toHaveValue('ring2');
  await expect(detail).toContainText('120 → 130');
  await detail.getByRole('combobox', { name: 'Equip to' }).selectOption('ring1');
  await expect(detail.getByRole('button', { name: 'Equip', exact: true })).toBeDisabled();
  await expect(detail).toContainText('120 → 120');
  await detail.getByRole('combobox', { name: 'Equip to' }).selectOption('ring2');
  await detail.getByRole('button', { name: 'Equip', exact: true }).click();
  await expect(page.locator('#hp')).toHaveText('60 / 130');
  await expect(panel.locator('.inventory-row').filter({ hasText: 'Orchard Ring' })).toHaveCount(0);
  await panel.locator('[data-action="slot-ring1"]').click();
  await expect(detail).toContainText('130 → 120');
  await detail.getByRole('button', { name: 'Unequip', exact: true }).click();
  await expect(page.locator('#hp')).toHaveText('60 / 120');
  await pick('Health Potion');
  await expect(detail).toContainText('Restores 40 health');
  await pick('Workshop Temper');
  await expect(detail).toContainText('Workshop Temper');
  await pick('Damaged Axe');
  await expect(detail.getByLabel('4 Iron', { exact: true })).toBeVisible();
  await expect(detail.locator('.salvage-yield .item-art[data-ready="true"]')).toHaveCount(1);
  await detail.getByRole('button', { name: 'Salvage all', exact: true }).click();
  await expect(panel.locator('.inventory-row').filter({ hasText: 'Damaged' })).toHaveCount(0);
  await expect(panel.locator('.inventory-row').filter({ hasText: 'Iron ×10' })).toBeVisible();
  await page.setViewportSize({ width: 640, height: 800 });
  await pick('Orchard Ring');
  await expect(detail.getByRole('button', { name: 'Equip', exact: true })).toBeInViewport({
    ratio: 1,
  });
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await capture('inventory-640');
  await expect(detail.locator('.item-comparison')).toBeInViewport({ ratio: 1 });
  await panel.getByRole('button', { name: 'Your kit', exact: true }).click();
  await expect(panel.locator('.inventory-bag')).toBeHidden();
  await panel.locator('[data-action="slot-ring2"]').click();
  await expect(detail).toContainText('120 → 110');
  await expect(detail.getByRole('button', { name: 'Unequip', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await capture('inventory-kit-640');
  await panel.getByRole('button', { name: 'Your pack', exact: true }).click();
  await expect(panel.locator('.inventory-equipment')).toBeHidden();
  await pick('Orchard Ring');
  await page.keyboard.press('Escape');
  await expect(page.locator('canvas')).toBeFocused();
  await page.keyboard.press('e');
  const forge = page.getByRole('dialog', { name: 'Forge workbench', exact: true });
  for (const name of ['Temper Sword', 'Rekindle Lantern'])
    await expect(forge.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  await capture('forge-640');
  await forge.getByRole('button', { name: 'Rekindle Lantern', exact: true }).click();
  await expect(forge.getByRole('button', { name: 'Confirm upgrade', exact: true })).toBeFocused();
  await expect(forge.getByRole('button', { name: 'Confirm upgrade', exact: true })).toBeInViewport({
    ratio: 1,
  });
  for (const name of ['Temper Sword', 'Rekindle Lantern'])
    await expect(forge.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  await forge.getByRole('button', { name: 'Temper Sword', exact: true }).click();
  await expect(forge.locator('h3')).toHaveText('Temper Sword');
  await expect(forge.locator('.forge-damage')).toContainText('26 → 52');
  await page.setViewportSize({ width: 1280, height: 720 });
  await capture('forge-1280');
  await page.keyboard.press('Shift+Tab');
  await expect(forge.getByRole('button', { name: 'Rekindle Lantern', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  await expect(page.locator('#hp')).toHaveText('60 / 120');
  await expect(panel.locator('[data-action="slot-trinket"]')).toContainText('Gatherer’s Seal');
  await expect(panel.locator('.inventory-row').filter({ hasText: 'Iron ×10' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('canvas')).toBeFocused();
});
