import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { test, expect } from './fixtures';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';

test('forge departure keeps the hero and cue clear of the toolbar without a bright surround', async ({
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
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  if (directory) await mkdir(directory, { recursive: true });
  const capture = await page.screenshot(
      directory ? { path: path.join(directory, 'camera-forge-departure.png') } : {},
    ),
    image = await sharp(capture).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    offset = (8 * image.info.width + 8) * 4;
  expect(Math.max(...image.data.subarray(offset, offset + 3))).toBeLessThan(40);
});
