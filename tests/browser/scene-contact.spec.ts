import { test, expect } from './fixtures';

test('death contacts remain rendered through the body hold and retire with the body', async ({
  page,
}) => {
  await page.goto('/sandbox.html?scene=systems-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  const records = await page.evaluate(() => {
    const f = window.foundation,
      p = f.presentation;
    f.pause(true);
    f.editPreview((sim) => {
      Object.assign(sim.hero, { x: 0, px: 0, z: 0, pz: 0 });
      const actor = sim.enemies.find((a) => a.definition.visual === 'ossuary-thrall')!;
      Object.assign(actor, { x: 1, px: 1, z: 0, pz: 0, health: 0, state: 'death', age: 1 });
    });
    p.lookRenderer.setSettings({ lighting: false, shadows: false });
    const records = [];
    for (const age of [1, 24, 44, 45, 60]) {
      f.editPreview((sim) => {
        sim.enemies.find((a) => a.definition.visual === 'ossuary-thrall')!.age = age;
      });
      p.update(f.sim, 1, 0, f.sim.hero);
      const actor = f.sim.enemies.find((a) => a.definition.visual === 'ossuary-thrall')!,
        visual = p.actorPresentation.actors.get(actor.id)!,
        gl = p.renderer.getContext();
      const capture = () => {
        p.update(f.sim, 1, 0, f.sim.hero);
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        return pixels;
      };
      visual.shadow.material.visible = false;
      const without = capture();
      visual.shadow.material.visible = true;
      const withContact = capture();
      let darkened = 0;
      for (let i = 0; i < without.length; i += 4)
        if (
          without[i]! +
            without[i + 1]! +
            without[i + 2]! -
            withContact[i]! -
            withContact[i + 1]! -
            withContact[i + 2]! >
          3
        )
          darkened++;
      records.push({
        age,
        body: visual.sprite.mesh.visible,
        shadow: visual.shadow.visible,
        opacity: visual.shadow.material.opacity,
        bodyOpacity: visual.sprite.material.opacity,
        darkened,
        error: gl.getError(),
      });
    }
    return records;
  });
  for (const row of records) {
    expect(row.error).toBe(0);
    expect(row.shadow).toBe(row.body);
    expect(row.body).toBe(row.age < 45);
    expect(row.opacity).toBeCloseTo(0.48 * row.bodyOpacity, 5);
    if (row.age <= 24) expect(row.darkened, JSON.stringify(records)).toBeGreaterThan(0);
    if (row.age >= 45) expect(row.darkened).toBe(0);
  }
});
