import { test, expect } from './fixtures';

test('a mouse click on a nearby enemy torso directs the live lunge toward its feet', async ({
  page,
}) => {
  await page.goto('/sandbox.html?scene=outdoor-fixture&automated');
  await page.waitForFunction(() => window.foundation?.ready);
  const pointer = await page.evaluate(async () => {
    const f = window.foundation;
    f.mode('encounter');
    f.pause(true);
    f.editPreview((sim) => {
      Object.assign(sim.hero, { x: 0, px: 0, z: 0, pz: 0, nextAttack: 'lunge' });
      Object.assign(sim.enemies[0]!, { x: 1.2, px: 1.2, z: 0, pz: 0, health: 100, stun: 10000 });
    });
    for (let i = 0; i < 60; i++) f.presentation.update(f.sim, 1, 1000 / 60, { x: 1.2, z: 0 });
    const p = f.presentation.camera.position
      .clone()
      .set(1.2, 1.1, 0)
      .project(f.presentation.camera);
    const bounds = f.presentation.canvas.getBoundingClientRect();
    f.pause(false);
    return {
      x: bounds.left + ((p.x + 1) * bounds.width) / 2,
      y: bounds.top + ((1 - p.y) * bounds.height) / 2,
    };
  });
  await page.locator('canvas').focus();
  await page.mouse.click(pointer.x, pointer.y);
  await expect.poll(() => page.evaluate(() => window.foundation.sim.enemies[0]!.health)).toBe(74);
  expect(await page.evaluate(() => window.foundation.sim.hero.attackKind)).toBe('lunge');
});
