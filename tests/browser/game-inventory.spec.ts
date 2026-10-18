import { clickCheckpointAction } from '../fixtures/input';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';

test('inventory compares replacements and upgrades keep selection and confirmation reachable', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const area = content.area('ruined-forge');
  const bench = area.campfires![0]!;
  const session = new GameSession(content, 142, area.id);
  const save = session.captureSave();
  Object.assign(save.player, { x: bench.x, z: bench.z, health: 60 });
  for (const actor of Object.values(save.areas[area.id]!.actors)) actor.health = 0;
  save.areas[area.id]!.cleared = true;
  delete save.adventure!.pack;
  Object.assign(save.adventure!.inventory, {
    gold: 24,
    iron: 5,
    bone: 2,
    'health-potion': 2,
    'orchard-ring': 2,
    'travellers-charm': 1,
    'gatherers-seal': 1,
    'damaged-axe': 2,
    'damaged-helmet': 1,
  });
  const profile = process.env.LANTERN_TEST_BUILT === 'true' ? 'game' : 'preview';
  await page.addInitScript(
    ({ key, save }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
    },
    { key: `lantern-prototype-${profile}-game`, save },
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/index.html?automated');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  const panel = page.getByRole('dialog', { name: 'Inventory', exact: true });
  const detail = panel.getByRole('region', { name: 'Selected item' });
  await expect(detail).toContainText('Select an item to inspect it.');
  await expect(panel.locator('.bag-empty')).toHaveCount(192);
  const pick = (name: string) =>
    panel.locator('.inventory-row').filter({ hasText: name }).first().click();
  const capture = async (name: string) => {
    const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await expect(page.locator('.adventure-panel .item-art:not([data-ready="true"])')).toHaveCount(
      0,
      { timeout: 60_000 },
    );
    await page.locator('.adventure-panel h2').click();
    await page.screenshot({ path: path.join(directory, `redesign-${name}.png`) });
  };
  await capture('inventory-overview-1280');
  await panel.locator('[data-action="slot-sword"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.locator('[data-action="slot-body"]')).toBeFocused();
  await panel.locator('[data-action="slot-lantern"]').click();
  await expect(detail).toContainText('Damage 28 per enemy');
  await detail.getByRole('button', { name: 'Close item details' }).click();
  await expect(detail).toContainText('Select an item to inspect it.');
  await expect(panel.locator('[data-action="slot-lantern"]')).toBeFocused();
  await panel.locator('[data-action="slot-lantern"]').click();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Organize', exact: true })).toBeFocused();
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
  await page.getByRole('button', { name: 'Upgrade kit', exact: true }).click();
  const upgrades = page.getByRole('dialog', { name: 'Upgrade kit', exact: true });
  for (const name of ['Temper Sword I', 'Rekindle Lantern I'])
    await expect(upgrades.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  await capture('upgrades-640');
  await upgrades.getByRole('button', { name: 'Rekindle Lantern I', exact: true }).click();
  await expect(upgrades.locator('.upgrade-damage')).toContainText('28 → 56');
  await upgrades.getByRole('button', { name: 'Temper Sword I', exact: true }).click();
  await expect(upgrades.locator('.upgrade-damage')).toContainText('26 → 52');
  await page.setViewportSize({ width: 1280, height: 720 });
  await capture('upgrades-1280');
  await page.keyboard.press('Escape');
  await page.locator('#pause').click();
  await clickCheckpointAction(page, 'save');
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
  await page.setViewportSize({ width: 1280, height: 600 });
  await panel.locator('[data-action="slot-sword"]').click();
  const equipmentBounds = await panel.locator('.inventory-equipment').boundingBox();
  expect(equipmentBounds!.height).toBeLessThanOrEqual(600);
  const contentBounds = await panel.locator('.inventory-content').boundingBox();
  const panelBounds = await panel.boundingBox();
  expect(contentBounds!.y + contentBounds!.height).toBeLessThanOrEqual(
    panelBounds!.y + panelBounds!.height - 30,
  );
  await detail.getByRole('button', { name: 'Unequip', exact: true }).focus();
  await expect(detail.getByRole('button', { name: 'Unequip', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await capture('inventory-short-1280');
  await page.keyboard.press('Escape');
  await expect(page.locator('canvas')).toBeFocused();
});

test('sized pack dragging, keyboard cancellation and organizing persist without shifting equipment', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const session = new GameSession(content, 142, 'ruined-forge');
  const save = session.captureSave();
  delete save.adventure!.pack;
  Object.assign(save.adventure!.inventory, {
    sword: 2,
    'orchard-ring': 2,
    'health-potion': 8,
    iron: 20,
  });
  for (const actor of Object.values(save.areas[save.area]!.actors)) actor.health = 0;
  save.areas[save.area]!.cleared = true;
  const profile = process.env.LANTERN_TEST_BUILT === 'true' ? 'game' : 'preview';
  await page.addInitScript(
    ({ key, save }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(save));
    },
    { key: `lantern-prototype-${profile}-game`, save },
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/index.html?automated');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  const panel = page.getByRole('dialog', { name: 'Inventory', exact: true });
  const equipment = await panel.locator('.inventory-equipment').boundingBox();
  const ring = panel.locator('.inventory-row[data-item="orchard-ring"]').first();
  await ring.click();
  expect(await panel.locator('.inventory-equipment').boundingBox()).toEqual(equipment);
  await expect(panel.locator('.inventory-row[data-item="orchard-ring"]')).toHaveCount(2);
  await expect(panel.locator('.inventory-row[data-item="health-potion"]')).toHaveCount(1);
  const key = (await ring.getAttribute('data-entry'))!;
  const readPosition = () =>
    page.evaluate((entry) => {
      const key = Object.keys(localStorage).find((key) => key.endsWith('-game'))!;
      return JSON.parse(localStorage.getItem(key)!).adventure.pack?.find(
        (item: { key: string }) => item.key === entry,
      );
    }, key);
  // Empty cells are intentionally pointer-transparent. Drop on the live grid
  // at a visible cell, as the player does, rather than targeting its decoration.
  const grid = panel.locator('.pack-items');
  const bounds = (await grid.boundingBox())!;
  await ring.dragTo(grid, {
    targetPosition: { x: (bounds.width / 12) * 10.5, y: (bounds.width / 12) * 5.5 },
  });
  await expect.poll(readPosition).toMatchObject({ x: 10, y: 5 });
  const before = await readPosition();
  const moved = panel.locator(`[data-entry="${key}"]`);
  await moved.press('m');
  await moved.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await expect(panel).toBeVisible();
  expect(await readPosition()).toEqual(before);
  await moved.press('m');
  await moved.press('ArrowLeft');
  await moved.press('Enter');
  await expect.poll(readPosition).toMatchObject({ x: 9, y: 5 });
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  await expect(panel.locator(`[data-entry="${key}"]`)).toHaveAttribute('style', /6 \/ 10/);
  await panel.getByRole('button', { name: 'Organize', exact: true }).click();
  await expect.poll(readPosition).not.toMatchObject({ x: 9, y: 5 });
  await page.keyboard.press('Escape');
  await page.locator('#pause').click();
  await page.locator('#menu-settings').click();
  await page.locator('#ui-scale').selectOption('1.15');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(localStorage).find((key) => key.endsWith('-settings'))!;
        return JSON.parse(localStorage.getItem(key)!).uiScale;
      }),
    )
    .toBe(1.15);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-settings').click();
  await expect(page.locator('#ui-scale')).toHaveValue('1.15');
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 600 },
    { width: 640, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page
        .locator('.menu-shell')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await expect(page.locator('#ui-scale')).toBeInViewport({ ratio: 1 });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#menu-back').click();
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  await panel.locator('.inventory-row[data-item="orchard-ring"]').first().click();
  const capture = async (name: string) => {
    const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await expect(panel.locator('.item-art:not([data-ready="true"])')).toHaveCount(0, {
      timeout: 60_000,
    });
    await page.screenshot({ path: path.join(directory, `${name}.png`) });
  };
  await expect(panel.getByRole('button', { name: 'Equip', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await capture('inventory-large-640');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture('inventory-large-1920');
  // A counts-only test setup exercises admission into a completely full pack.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.endsWith('-game'))!;
    const saved = JSON.parse(localStorage.getItem(key)!);
    const counts: Record<string, number> = { gold: 248 };
    for (const item of Object.values(saved.adventure.equipment) as string[])
      counts[item] = (counts[item] ?? 0) + 1;
    counts['orchard-ring'] = (counts['orchard-ring'] ?? 0) + 192;
    saved.adventure.inventory = counts;
    delete saved.adventure.pack;
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
  );
  await page.locator('#menu-start').click();
  await page.keyboard.press('i');
  await expect(panel.locator('.inventory-row')).toHaveCount(192);
  await expect(panel.locator('.pack-heading')).toContainText('192 / 192');
  await capture('inventory-full-1920');
  await panel.locator('[data-action="slot-sword"]').click();
  await panel.getByRole('button', { name: 'Unequip', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Your pack is full');
  await expect(panel.locator('.inventory-slot.slot-sword')).toHaveAttribute(
    'aria-label',
    'Sword · Sword',
  );
});
