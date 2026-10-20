import path from 'node:path';
import { stateTest as test, expect } from './fixtures';
import { loadCheckpoint, saveCheckpoint } from '../fixtures/input';
import { content } from '../../src/content/game-content';

test('clicking a distant label routes to one stack and preserves its siblings on reload', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/index.html?automated');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#menu-start').click();
  await page.locator('#pause').click();
  await saveCheckpoint(page);
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
  await saveCheckpoint(page);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.adventure.inventory['orchard-ring']).toBe(1);
  expect(saved.areas[saved.area].drops).toHaveLength(rewardCount - 1);
  await loadCheckpoint(page);
  await expect(page.locator('.ground-loot-label')).toHaveCount(rewardCount - 1);
  await page.keyboard.press('e');
  await expect(page.locator('.ground-loot-label')).toHaveCount(rewardCount - 2, {
    timeout: 30_000,
  });
});

test('crowded loot stays visible and leaving a focused label restores the nearest E action', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/index.html?automated');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#menu-start').click();
  await page.locator('#pause').click();
  await saveCheckpoint(page);
  const area = content.area(content.definitions.initialArea);
  const drops = [
    ...area.interactables!.flatMap((object) =>
      object.rewards.map((reward, index) => ({
        id: `object-${object.id}-${index}`,
        source: object.id,
        enemy: false,
        rewards: [reward],
      })),
    ),
    ...area.spawns.flatMap((spawn) =>
      (spawn.rewards ?? []).map((reward, index) => ({
        id: `enemy-${spawn.id}-${index}`,
        source: spawn.id,
        enemy: true,
        rewards: [reward],
      })),
    ),
  ];
  expect(drops.length).toBeGreaterThan(6);
  await page.evaluate(
    ({ drops, claims }) => {
      const key = Object.keys(localStorage).find((key) => key.endsWith('-game'))!;
      const save = JSON.parse(localStorage.getItem(key)!);
      const state = save.areas[save.area];
      for (const actor of Object.values(state.actors) as { health: number; burn?: unknown }[]) {
        actor.health = 0;
        delete actor.burn;
      }
      state.cleared = true;
      state.claimedObjects = claims;
      state.drops = drops.map((drop) => ({ ...drop, x: save.player.x, z: save.player.z }));
      localStorage.setItem(key, JSON.stringify(save));
    },
    { drops, claims: area.interactables!.map((object) => object.id) },
  );
  await loadCheckpoint(page);
  const labels = page.locator('.ground-loot-label');
  await expect(labels).toHaveCount(drops.length);
  await page.locator('.ground-loot-labels').evaluate((root) => {
    Object.assign((root as HTMLElement).style, { inset: 'auto 0 160px', height: '100px' });
  });
  await expect
    .poll(() =>
      labels.evaluateAll((buttons) => {
        const bounds = buttons[0]!.parentElement!.getBoundingClientRect();
        const boxes = buttons.map((button) => button.getBoundingClientRect());
        return boxes.every(
          (box, index) =>
            box.left >= bounds.left &&
            box.right <= bounds.right &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom &&
            boxes
              .slice(index + 1)
              .every(
                (other) =>
                  box.right <= other.left ||
                  box.left >= other.right ||
                  box.bottom <= other.top ||
                  box.top >= other.bottom,
              ),
        );
      }),
    )
    .toBe(true);
  if (process.env.LANTERN_OPENING_CAPTURE_DIRECTORY)
    await page.screenshot({
      path: path.join(process.env.LANTERN_OPENING_CAPTURE_DIRECTORY, 'crowded-loot.png'),
    });
  const focused = page.locator('[data-drop="enemy-first-0"]');
  await focused.focus();
  await page.locator('canvas').focus();
  await page.keyboard.press('e');
  await expect(page.locator(`[data-drop="${drops[0]!.id}"]`)).toHaveCount(0);
  await expect(focused).toHaveCount(1);
});
