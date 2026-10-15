import { mkdir } from 'node:fs/promises';
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
  await expect(page.locator('.ground-loot-label')).toHaveCount(3);
  if (process.env.LANTERN_OPENING_CAPTURE_DIRECTORY)
    await page.screenshot({
      path: path.join(process.env.LANTERN_OPENING_CAPTURE_DIRECTORY, 'ground-item-labels.png'),
    });
  await page.getByRole('button', { name: 'Collect Orchard Ring', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Collect Orchard Ring', exact: true })).toHaveCount(
    0,
    { timeout: 20_000 },
  );
  await expect(page.locator('.ground-loot-label')).toHaveCount(2);
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key);
  expect(saved.adventure.inventory['orchard-ring']).toBe(1);
  expect(saved.areas[saved.area].drops).toHaveLength(2);
  await loadCheckpoint(page);
  await expect(page.locator('.ground-loot-label')).toHaveCount(2);
  await page.keyboard.press('e');
  await expect(page.locator('.ground-loot-label')).toHaveCount(1);
});

test('requested supplied-artwork comparison captures', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit visual review captures only');
  test.setTimeout(300_000);
  await mkdir(directory!, { recursive: true });
  for (const treatment of ['gust', 'leaves', 'combined']) {
    await page.goto(`/index.html?automated&wind-preview=${treatment}`);
    await page.locator('canvas[data-ready="true"]').waitFor();
    await page.locator('#pause').click();
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = -0.707107;
      save.player.z = 0.707107;
      const state = save.areas[save.area];
      for (const actor of Object.values(state.actors) as { health: number }[]) actor.health = 0;
      state.cleared = true;
      localStorage.setItem(key, JSON.stringify(save));
    });
    await loadCheckpoint(page);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(directory!, `wind-${treatment}.png`) });
  }
  await page.mouse.move(950, 380);
  await page.mouse.click(950, 380, { button: 'right' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(directory!, 'lantern-flare.png') });
  await page.waitForTimeout(700);
  await page.mouse.click(950, 380);
  await page.waitForTimeout(700);
  await page.mouse.click(950, 380);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(directory!, 'lunge.png') });
  await page.waitForTimeout(700);
  await page.mouse.move(350, 450);
  await page.keyboard.press('Shift');
  await page.waitForTimeout(170);
  await page.screenshot({ path: path.join(directory!, 'dodge.png') });
  for (const treatment of ['dust', 'leaves', 'combined']) {
    await page.goto(`/index.html?automated&dodge-preview=${treatment}`);
    await page.locator('canvas[data-ready="true"]').waitFor();
    await page.locator('#pause').click();
    await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
      const save = JSON.parse(localStorage.getItem(key)!);
      save.player.x = -0.707107;
      save.player.z = 0.707107;
      localStorage.setItem(key, JSON.stringify(save));
    });
    await loadCheckpoint(page);
    await page.waitForTimeout(1000);
    await page.mouse.move(350, 450);
    await page.keyboard.press('Shift');
    await page.waitForTimeout(180);
    await expect(page.locator('#status')).not.toContainText('cooling down');
    await page.screenshot({ path: path.join(directory!, `dodge-${treatment}.png`) });
  }
});

test('requested run contact drawing review in every heading', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit footfall drawing review only');
  test.setTimeout(180_000);
  await page.goto('/sandbox.html');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.getByRole('button', { name: 'Animation', exact: true }).click();
  await page.locator('#clip').selectOption('walk');
  if ((await page.locator('#pause').textContent()) === 'Pause')
    await page.locator('#pause').click();
  for (const heading of ['d00', 'd45', 'd90', 'd135', 'd180', 'd225', 'd270', 'd315']) {
    await page.locator('#heading').selectOption(heading);
    const times = await page.evaluate(
      (heading) =>
        window.foundation.presentation
          .getClip('walk', heading as any)
          .notifies.filter((n) => n.kind === 'footstep')
          .map((n) => n.atMs),
      heading,
    );
    expect(times).toHaveLength(2);
    for (const [index, time] of times.entries()) {
      await page.locator('#scrub').evaluate((node, time) => {
        const input = node as HTMLInputElement;
        input.value = String(time + 1);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, time);
      await page.screenshot({ path: path.join(directory!, `contact-${heading}-${index}.png`) });
    }
  }
});

test('requested lighting and Lunge facing captures', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit lighting and action registration review only');
  test.setTimeout(240_000);
  await mkdir(directory!, { recursive: true });
  await page.goto('/index.html?automated');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
    const save = JSON.parse(localStorage.getItem(key)!);
    save.player.x = -0.707107;
    save.player.z = 0.707107;
    const state = save.areas[save.area];
    for (const actor of Object.values(state.actors) as { health: number }[]) actor.health = 0;
    state.cleared = true;
    localStorage.setItem(key, JSON.stringify(save));
  });
  // Every rig loads the same checkpoint and camera pose.
  for (const rig of ['golden', 'silver', 'lantern']) {
    await page.goto(`/index.html?automated&lighting-preview=${rig}`);
    await page.locator('canvas[data-ready="true"]').waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(directory!, `lighting-${rig}.png`) });
  }
  for (const [facing, x, y] of [
    ['right', 950, 150],
    ['up', 350, 150],
    ['left', 350, 650],
    ['down', 950, 650],
  ] as const) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(700);
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(directory!, `lunge-${facing}.png`) });
    await page.waitForTimeout(700);
  }
});

test('requested corrected Orchard placement captures', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit placement review captures only');
  test.setTimeout(240_000);
  await page.goto('/index.html?automated');
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.locator('#pause').click();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
  for (const [name, x, z] of [
    ['east', 8.5, -4],
    ['south', 10, 3],
    ['west', -5, 5],
  ] as const) {
    if (name !== 'east') await page.locator('#pause').click();
    await page.evaluate(
      ({ x, z }) => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('-game'))!;
        const save = JSON.parse(localStorage.getItem(key)!);
        save.player.x = x;
        save.player.z = z;
        localStorage.setItem(key, JSON.stringify(save));
      },
      { x, z },
    );
    await loadCheckpoint(page);
    await page.screenshot({ path: path.join(directory!, `orchard-${name}-clearance.png`) });
  }
});
