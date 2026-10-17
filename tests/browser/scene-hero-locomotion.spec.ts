import { test, expect } from './fixtures';

test('cursor-facing locomotion renders every facing/travel pair and preserves phase through transitions', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto('/sandbox.html?scene=outdoor-fixture&automated');
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.presentation.lookRenderer.ready,
  );
  const result = await page.evaluate(() => {
    const f = window.foundation,
      headings = ['d00', 'd45', 'd90', 'd135', 'd180', 'd225', 'd270', 'd315'];
    f.mode('encounter');
    f.pause(true);
    f.editPreview((sim) => {
      sim.actors = [sim.hero];
    });
    const actor = () => f.presentation.actorPresentation.actors.get(f.sim.hero.id)!;
    const selected: string[] = [];
    for (let facing = 0; facing < 8; facing++)
      for (let travel = 0; travel < 8; travel++) {
        f.editPreview((sim) => {
          Object.assign(sim.hero, { x: 0, px: 0, z: 0, pz: 0, state: 'idle' });
          sim.step({
            move: { x: Math.sin((travel * Math.PI) / 4), z: Math.cos((travel * Math.PI) / 4) },
            aim: {
              x: Math.sin((facing * Math.PI) / 4) * 10,
              z: Math.cos((facing * Math.PI) / 4) * 10,
            },
          });
        });
        f.presentation.update(f.sim, 1, 0, { x: 0, z: 0 });
        const v = actor(),
          expected =
            f.presentation.manifest.asset.clips[`travel_${headings[travel]}`]![
              headings[facing] as 'd00'
            ]!;
        if (v.sprite.animator.clip !== expected)
          throw new Error(`Wrong selection ${facing}/${travel}`);
        selected.push(`${headings[facing]}/${headings[travel]}`);
        // Held source drawings must all reach the renderer, including terminal-to-start wrap.
        for (let tick = 0; tick <= 40; tick += 5) {
          v.sprite.animator.seek((tick * 1000) / 60);
          f.presentation.update(f.sim, 1, 0, { x: 0, z: 0 });
          if (!v.sprite.lightingSample?.frame || f.presentation.renderer.getContext().getError())
            throw new Error('Missing frame or WebGL error');
        }
        v.sprite.animator.seek(400);
        f.editPreview((sim) => {
          sim.hero.travelYaw = (((travel + 1) % 8) * Math.PI) / 4;
        });
        f.presentation.update(f.sim, 1, 0, { x: 0, z: 0 });
        if (Math.abs(actor().sprite.animator.time - 400) > 0.001)
          throw new Error('Travel phase reset');
        f.editPreview((sim) => {
          sim.hero.state = 'idle';
        });
        f.presentation.update(f.sim, 1, 0, { x: 0, z: 0 });
        if (
          actor().sprite.animator.clip !==
          f.presentation.manifest.asset.clips.idle![headings[facing] as 'd00']
        )
          throw new Error('Wrong stationary facing');
      }
    return selected;
  });
  expect(new Set(result).size).toBe(64);
  await page.locator('[data-panel="animation"]').click();
  await expect(page.locator('#travel-label')).toBeVisible();
  await page.locator('#heading').selectOption('d135');
  await page.locator('#travel').selectOption('d315');
  await expect
    .poll(() => page.evaluate(() => window.foundation.presentation.labClip))
    .toBe('travel_d315');
  expect(await page.locator('#heading').inputValue()).toBe('d135');
  await page.locator('#return-scene').click();
  const cursor = await page.evaluate(() => {
    const f = window.foundation;
    f.pause(true);
    f.editPreview((sim) => {
      Object.assign(sim.hero, { x: 0, px: 0, z: 0, pz: 0, state: 'idle', aim: Math.PI / 2 });
    });
    f.presentation.update(f.sim, 1, 0, { x: 4, z: 0 });
    const p = f.presentation.camera.position.clone().set(4, 0, 0).project(f.presentation.camera);
    const rect = f.presentation.canvas.getBoundingClientRect();
    f.pause(false);
    return {
      x: rect.left + ((p.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - p.y) * rect.height) / 2,
    };
  });
  await page.locator('canvas').focus();
  await page.mouse.move(cursor.x, cursor.y);
  await page.keyboard.down('KeyW');
  try {
    await expect
      .poll(() =>
        page.evaluate(() => {
          const f = window.foundation,
            v = f.presentation.actorPresentation.actors.get(f.sim.hero.id)!;
          return { state: f.sim.hero.state, facing: v.heading, travel: v.travelHeading };
        }),
      )
      .toEqual({ state: 'walk', facing: 'd90', travel: 'd225' });
  } finally {
    await page.keyboard.up('KeyW');
  }
  await expect.poll(() => page.evaluate(() => window.foundation.sim.hero.state)).toBe('idle');
});
