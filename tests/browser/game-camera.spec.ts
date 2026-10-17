import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { test, expect } from './fixtures';
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
  for (const [name, width, height] of [
    ['landscape', 1600, 900],
    ['portrait', 900, 1600],
    ['wide', 2100, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => {
        const hint = (await cue.boundingBox())!;
        return hint.y > 80 && hint.y + hint.height < height;
      })
      .toBe(true);
    // Let the resized drawing buffer settle before checking the rendered edge.
    await page.waitForTimeout(500);
    const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
    if (directory) await mkdir(directory, { recursive: true });
    const capture = await page.screenshot(
        directory ? { path: path.join(directory, `camera-forge-${name}.png`) } : {},
      ),
      image = await sharp(capture).metadata(),
      strip = await sharp(capture)
        .extract({
          left: Math.floor(image.width! * 0.4),
          top: 8,
          width: Math.floor(image.width! * 0.2),
          height: 48,
        })
        .stats();
    // The old ink-dark band was a flat clear color behind the finite painting.
    // Scene geometry tests protect exact coverage; this checks real rendered art.
    expect(Math.max(...strip.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(
      2,
    );
  }
  // game-chapel.spec.ts owns the full departure, reward and return journey.
});
