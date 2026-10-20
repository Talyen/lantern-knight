import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { pixelTest as test, expect } from './fixtures';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';

test('forge departure keeps the hero below controls with artwork across the upper viewport', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const area = content.area('ruined-forge'),
    departure = area.exits.find((exit) => exit.destination === 'desecrated-chapel')!,
    session = new GameSession(content, 142, area.id);
  for (const enemy of session.sim.enemies) enemy.health = 0;
  Object.assign(session.sim.hero, departure.marker!);
  const save = session.captureSave();
  save.areas[area.id]!.cleared = true;
  const profile = process.env.LANTERN_TEST_BUILT === 'true' ? 'game' : 'preview';
  await page.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), {
    key: `lantern-prototype-${profile}-game`,
    save,
  });
  await page.goto('/index.html?automated');
  await page.waitForFunction(
    () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    undefined,
    { timeout: 180_000 },
  );
  await page.getByRole('button', { name: 'Continue journey', exact: true }).click();
  const cue = page.locator('#interaction-hint');
  await expect(cue).toHaveText('E · Travel to Desecrated Chapel', { timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const hint = (await cue.boundingBox())!,
          toolbar = (await page.locator('.game-toolbar').boundingBox())!;
        return (
          hint.y > toolbar.y + toolbar.height + 12 &&
          hint.y + hint.height < page.viewportSize()!.height
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const width = 1280,
    height = 600;
  await page.setViewportSize({ width, height });
  await expect
    .poll(async () => {
      const hint = (await cue.boundingBox())!;
      return hint.y > 80 && hint.y + hint.height < height;
    })
    .toBe(true);
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, 'camera-forge-wide.png') });
  }
  // Capture the native pixels the assertion actually uses, without encoding the whole frame.
  const strip = await sharp(
    await page.screenshot({
      clip: { x: width * 0.4, y: 8, width: width * 0.2, height: 48 },
    }),
  ).stats();
  expect(Math.max(...strip.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(
    2,
  );
  // game-chapel.spec.ts owns the full departure, reward and return journey.
});
