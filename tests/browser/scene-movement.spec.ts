import { test, expect } from './fixtures';

test('keyboard movement renders forward runs in all eight directions and cursor movement leaves idle facing alone', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/sandbox.html?scene=outdoor-fixture&automated');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.evaluate(() => {
    const f = window.foundation;
    f.mode('encounter');
    f.pause(true);
    f.editPreview((sim) => {
      sim.actors = [sim.hero];
    });
  });
  await page.locator('canvas').focus();
  const bounds = (await page.locator('canvas').boundingBox())!;
  const directions = [['s', 'a'], ['s'], ['s', 'd'], ['d'], ['w', 'd'], ['w'], ['w', 'a'], ['a']];
  for (const [index, keys] of directions.entries()) {
    await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.7);
    await page.evaluate(() => {
      const f = window.foundation;
      f.editPreview((sim) => {
        Object.assign(sim.hero, { x: 0, z: 0, px: 0, pz: 0 });
      });
      f.pause(false);
    });
    for (const key of keys) await page.keyboard.down(key);
    await expect.poll(() => page.evaluate(() => window.foundation.sim.hero.state)).toBe('walk');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const f = window.foundation;
          return f.presentation.actorPresentation.actors.get(f.sim.hero.id)?.heading;
        }),
      )
      .toBe(`d${String(index * 45).padStart(2, '0')}`);
    const moving = await page.evaluate(() => {
      const f = window.foundation;
      f.pause(true);
      const visual = f.presentation.actorPresentation.actors.get(f.sim.hero.id)!;
      return {
        yaw: f.sim.hero.yaw,
        travel: f.sim.hero.travelYaw,
        tag: visual.tag,
        heading: visual.heading,
      };
    });
    expect(moving.yaw).toBe(moving.travel);
    expect(moving.tag).toContain(`:travel_${moving.heading}:${moving.heading}:`);
    if (process.env.LANTERN_MOVEMENT_CAPTURES)
      await page.screenshot({ path: testInfo.outputPath(`forward-${moving.heading}.png`) });
    for (const key of keys) await page.keyboard.up(key);
    await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.4);
    await page.evaluate(() => window.foundation.pause(false));
    await expect.poll(() => page.evaluate(() => window.foundation.sim.hero.state)).toBe('idle');
    const idle = await page.evaluate(() => {
      const f = window.foundation;
      f.pause(true);
      return { state: f.sim.hero.state, yaw: f.sim.hero.yaw };
    });
    expect(idle).toEqual({ state: 'idle', yaw: moving.yaw });
  }
  if (process.env.LANTERN_MOVEMENT_CAPTURES)
    await page.screenshot({ path: testInfo.outputPath('movement-facing.png') });
});
