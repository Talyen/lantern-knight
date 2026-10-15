import path from 'node:path';
import { test, expect } from './fixtures';
import { loadCheckpoint } from '../fixtures/input';
import { content } from '../../src/content/game-content';

test('clicking a distant label routes to one stack and preserves its siblings on reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/index.html?automated');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#menu-start').click();
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const chest = content
    .area('abandoned-orchard')
    .interactables!.find((o) => o.kind === 'container')!;
  const key = await page.evaluate(() =>
    Object.keys(localStorage).find((k) => k.endsWith('-game'))!,
  );
  await page.evaluate(
    ({ chest, key }) => {
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = chest.x + 2.7;
      save.player.z = chest.z + 0.7;
      const state = save.areas[save.area];
      for (const actor of Object.values(state.actors) as { health: number }[]) actor.health = 0;
      state.cleared = true;
      state.claimedObjects = [chest.id];
      state.drops = chest.rewards.map((reward, i) => ({
        id: `object-${chest.id}-${i}`,
        source: chest.id,
        enemy: false,
        x: chest.x,
        z: chest.z,
        rewards: [reward],
      }));
      localStorage.setItem(key, JSON.stringify(save));
    },
    { chest, key },
  );
  await loadCheckpoint(page);
  const rewardCount = chest.rewards.length;
  expect(rewardCount).toBeGreaterThan(1);
  await expect(page.locator('.ground-loot-label')).toHaveCount(rewardCount);
  if (process.env.LANTERN_OPENING_CAPTURE_DIRECTORY)
    await page.screenshot({
      path: path.join(process.env.LANTERN_OPENING_CAPTURE_DIRECTORY, 'ground-item-labels.png'),
    });
  await page.getByRole('button', { name: 'Collect Orchard Ring', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collect Orchard Ring', exact: true })).toHaveCount(
    0,
    { timeout: 20_000 },
  );
  await expect(page.locator('.ground-loot-label')).toHaveCount(rewardCount - 1);
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.adventure.inventory['orchard-ring']).toBe(1);
  expect(saved.areas[saved.area].drops).toHaveLength(rewardCount - 1);
  await loadCheckpoint(page);
  await expect(page.locator('.ground-loot-label')).toHaveCount(rewardCount - 1);
  await page.keyboard.press('e');
  await expect(page.locator('.ground-loot-label')).toHaveCount(rewardCount - 2);
});
