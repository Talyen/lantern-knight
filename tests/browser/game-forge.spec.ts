import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { activateWithKeyboard, test, expect } from './fixtures';
import { loadCheckpoint, saveCheckpoint } from '../fixtures/input';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import type { GameSave } from '../../src/core/save';

test.use({ actionTimeout: 30_000 });

test('clearing reward and forge salvage survive travel, rest and death recovery', async ({
  page,
}) => {
  // The complete return journey includes several cold room rebuilds and a reload.
  test.setTimeout(720_000);
  const clearing = content.area('forest-gathering-clearing');
  const forge = content.area('ruined-forge');
  const chest = clearing.interactables![0]!;
  const orchard = content.area('abandoned-orchard');
  const forward = orchard.exits.find((e) => e.destination === forge.id)!;
  const clearingReturn = clearing.exits[0]!;
  const tools = forge.interactables![0]!;
  const fire = forge.campfires![0]!;
  const ironAmount = tools.rewards.find((r) => r.item === 'iron')!.amount;
  const session = new GameSession(content, 142, clearing.id);
  Object.assign(session.sim.hero, { x: clearing.campfires![0]!.x, z: clearing.campfires![0]!.z });
  session.discoverFire(clearing.id + '/arrival');
  Object.assign(session.sim.hero, { x: chest.x, z: chest.z });
  session.sim.enemies.forEach((a) => (a.health = 0));
  const seed = session.captureSave();
  seed.areas[clearing.id]!.cleared = true;
  // A cold software-rendered room can take as long as a checkpoint rebuild.
  const roomTimeout = 120_000;
  const settled = () =>
    expect(page.locator('body')).not.toHaveClass(/traveling/, { timeout: roomTimeout });
  const walkThrough = async (name: string) => {
    await expect(page.locator('#interaction-hint')).toHaveText(`E · Travel to ${name}`);
    await page.keyboard.press('e');
    await expect(page.locator('#room-title')).toHaveText(name, { timeout: roomTimeout });
    await settled();
  };
  const capture = async (name: string) => {
    const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await expect(page.locator('.travel-veil')).toHaveCSS('opacity', '0');
    await page.screenshot({ path: path.join(directory, name + '.png') });
  };
  await page.goto('/index.html?automated');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    undefined,
    { timeout: 180_000 },
  );
  await activateWithKeyboard(page.locator('#menu-start'));
  await page.locator('#pause').click();
  await saveCheckpoint(page);
  const key = await page.evaluate(() =>
    Object.keys(localStorage).find((k) => k.endsWith('-game'))!,
  );
  const restore = async (save: GameSave) => {
    await page.evaluate(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
      key,
      save,
    });
    await loadCheckpoint(page);
    await settled();
  };
  const saveCurrent = async (): Promise<GameSave> => {
    await page.locator('#pause').click();
    await saveCheckpoint(page);
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  };
  await restore(seed);
  await expect(page.locator('#interaction-hint')).toHaveText('E · Open');
  await capture('clearing-ritual-cache');
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Collect Gatherer’s Seal', exact: true }).click();
  await page.locator('#open-inventory').click();
  const panel = page.locator('.adventure-panel');
  await activateWithKeyboard(page.locator('.inventory-row').filter({ hasText: 'Gatherer’s Seal' }));
  await activateWithKeyboard(panel.getByRole('button', { name: 'Equip', exact: true }));
  await expect(page.locator('#hp')).toHaveText('100 / 110');
  await page.keyboard.press('Escape');
  const onward = await saveCurrent();
  Object.assign(onward.player, clearingReturn.marker);
  await restore(onward);
  await walkThrough(orchard.name);
  const orchardOnward = await saveCurrent();
  Object.assign(orchardOnward.player, forward.marker);
  await restore(orchardOnward);
  await walkThrough(forge.name);
  await capture('forge-arrival');
  const arrival = await saveCurrent();
  Object.assign(arrival.player, { x: fire.x, z: fire.z });
  await restore(arrival);
  await expect(page.locator('#interaction-hint')).toHaveText('E · Rest');
  await page.keyboard.press('e');
  await expect(panel).toContainText(fire.name);
  await page.keyboard.press('Escape');
  const workshop = await saveCurrent();
  Object.assign(workshop.player, { x: tools.x, z: tools.z });
  // Isolate cache/UI persistence from combat timing, as in the orchard journey.
  for (const actor of Object.values(workshop.areas[forge.id]!.actors)) actor.health = 0;
  workshop.areas[forge.id]!.cleared = true;
  const ironBefore = workshop.adventure!.inventory.iron ?? 0;
  await restore(workshop);
  await expect(page.locator('#interaction-hint')).toHaveText('E · Open');
  await capture('forge-tool-cache');
  await page.keyboard.press('e');
  await page.getByRole('button', { name: `Collect Iron ×${ironAmount}`, exact: true }).click();
  await page.getByRole('button', { name: 'Collect Cinder Signet', exact: true }).click();
  const collected = await saveCurrent();
  expect(collected.adventure!.inventory['cinder-signet']).toBe(1);
  expect(collected.adventure!.inventory.iron).toBe(ironBefore + ironAmount);
  expect(collected.areas[forge.id]!.claimedObjects).toContain(tools.id);
  Object.assign(collected.player, forge.exits[0]!.marker);
  await restore(collected);
  await walkThrough(orchard.name);
  await capture('clearing-return-path');
  const returned = await saveCurrent();
  expect(
    Math.hypot(returned.player.x - forward.marker.x, returned.player.z - forward.marker.z),
  ).toBeLessThan(4);
  expect(
    Math.hypot(returned.player.x - forward.marker.x, returned.player.z - forward.marker.z),
  ).toBeGreaterThan(1.6);
  expect(
    Math.hypot(
      returned.player.x - orchard.campfires![0]!.x,
      returned.player.z - orchard.campfires![0]!.z,
    ),
  ).toBeGreaterThan(1.6);

  const clearingPath = orchard.exits.find((e) => e.destination === clearing.id)!;
  Object.assign(returned.player, clearingPath.marker);
  await restore(returned);
  await walkThrough(clearing.name);
  const clearingArrival = await saveCurrent();
  // Exercise the other on-foot boundary without coupling this persistence case to route timing.
  const back = clearing.exits.find((exit) => exit.destination === 'abandoned-orchard')!;
  Object.assign(clearingArrival.player, back.marker);
  await restore(clearingArrival);
  await walkThrough('Abandoned Orchard');
  await capture('orchard-return-path');
  const orchardReturn = await saveCurrent();
  const orchardPath = content.area('abandoned-orchard').exits[0]!.marker;
  expect(
    Math.hypot(orchardReturn.player.x - orchardPath.x, orchardReturn.player.z - orchardPath.z),
  ).toBeLessThan(4);
  expect(
    Math.hypot(orchardReturn.player.x - orchardPath.x, orchardReturn.player.z - orchardPath.z),
  ).toBeGreaterThan(1.6);

  Object.assign(clearingArrival.player, {
    x: clearing.campfires![0]!.x,
    z: clearing.campfires![0]!.z,
  });
  await restore(clearingArrival);
  await expect(page.locator('#interaction-hint')).toHaveText('E · Rest');
  await page.keyboard.press('e');
  await panel.getByRole('button', { name: forge.name + ' · ' + fire.name }).click();
  await expect(page.locator('#room-title')).toHaveText(forge.name, { timeout: roomTimeout });
  await settled();
  await panel.getByRole('button', { name: 'Rest', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Rested · health restored', { timeout: 60_000 });
  await page.keyboard.press('Escape');
  const rested = await saveCurrent();
  expect(rested.areas[forge.id]!.claimedObjects).toContain(tools.id);
  expect(rested.adventure!.inventory['cinder-signet']).toBe(1);
  expect(rested.adventure!.inventory.iron).toBe(ironBefore + ironAmount);
  rested.player.health = 0;
  await restore(rested);
  await expect(page.locator('#hp')).toHaveText('110 / 110', { timeout: 60_000 });
  await settled();
  const recovered = await saveCurrent();
  expect(recovered.area).toBe(forge.id);
  expect(recovered.areas[forge.id]!.claimedObjects).toContain(tools.id);
  expect(recovered.adventure!.inventory['cinder-signet']).toBe(1);
  expect(recovered.adventure!.inventory.iron).toBe(ironBefore + ironAmount);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    undefined,
    { timeout: 180_000 },
  );
  await activateWithKeyboard(page.locator('#menu-start'));
  await expect(page.locator('#room-title')).toHaveText(forge.name);
  await expect(page.locator('#hp')).toHaveText('110 / 110');
  await capture('forge-resumed');
});
