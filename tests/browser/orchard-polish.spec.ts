import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from './fixtures';
import { loadCheckpoint } from '../fixtures/input';

test('requested cohesion render cost comparison', async ({ page }) => {
  const directory = process.env.LANTERN_COHESION_MEASUREMENTS;
  test.skip(!directory, 'Explicit renderer measurement only');
  test.setTimeout(240_000);
  await page.goto('/sandbox.html?scene=orchard-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  const record = await page.evaluate(() => {
    const f = window.foundation,
      p = f.presentation;
    f.pause(true);
    f.editPreview((sim) => {
      Object.assign(sim.hero, { x: -0.7, px: -0.7, z: 4.8, pz: 4.8, yaw: Math.PI / 2 });
    });
    const gl = p.renderer.getContext(),
      samples = [];
    const render = () => p.update(f.sim, 1, 0, { x: 0.3, z: 4.8 });
    for (let pair = 0; pair < 5; pair++)
      for (const enabled of pair % 2 ? [true, false] : [false, true]) {
        p.lookRenderer.setSettings({
          paintedValues: enabled,
          paintedFinish: enabled,
          groundBounce: enabled,
          tightContacts: enabled,
        });
        const coldStart = performance.now();
        render();
        gl.finish();
        const firstRenderMs = performance.now() - coldStart;
        for (let i = 0; i < 15; i++) render();
        gl.finish();
        const frames = [];
        for (let i = 0; i < 30; i++) {
          const start = performance.now();
          render();
          gl.finish();
          frames.push(performance.now() - start);
        }
        samples.push({ enabled, firstRenderMs, frames, cost: p.lookRenderer.stats().frameCost });
      }
    return {
      samples,
      stats: p.stats(),
      error: gl.getError(),
      userAgent: navigator.userAgent,
      limitations: [
        'Frozen-pose synchronous rendering includes CPU submission and GPU completion, not display presentation or gameplay simulation.',
      ],
    };
  });
  await mkdir(directory!, { recursive: true });
  await writeFile(path.join(directory!, 'render-cost.json'), JSON.stringify(record, null, 2));
  expect(record.error).toBe(0);
  for (const sample of record.samples) expect(sample.frames.length).toBe(30);
});

test('requested orchard cohesion comparisons', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit cohesion review captures only');
  test.setTimeout(240_000);
  await mkdir(directory!, { recursive: true });
  await page.goto('/sandbox.html?scene=orchard-fixture');
  await page.waitForFunction(() => window.foundation?.ready);
  await page.evaluate(() => window.foundation.pause(true));
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
  for (const [view, x, z] of [
    ['camp', 7.4, 9],
    ['cart', 10.5, 3],
    ['fight', -0.7, 4.8],
    ['shade', 6.9, 2.2],
  ] as const) {
    await page.evaluate(
      ({ x, z }) => {
        const f = window.foundation;
        f.editPreview((sim) => {
          Object.assign(sim.hero, { x, px: x, z, pz: z, yaw: Math.PI / 2 });
        });
        f.presentation.update(f.sim, 1, 0, { x: x + 1, z });
      },
      { x, z },
    );
    for (const rig of ['lantern', 'silver'] as const)
      for (const treatment of [
        'before',
        'values',
        'bounce',
        'contacts',
        'finish',
        'combined',
      ] as const) {
        await page.evaluate(
          ({ rig, treatment }) => {
            const f = window.foundation;
            f.presentation.lookRenderer.setSettings({
              rig,
              paintedValues: treatment === 'values' || treatment === 'combined',
              paintedFinish: treatment === 'finish' || treatment === 'combined',
              groundBounce: treatment === 'bounce' || treatment === 'combined',
              tightContacts: treatment === 'contacts' || treatment === 'combined',
            });
            f.presentation.update(f.sim, 1, 0, { x: f.sim.hero.x + 1, z: f.sim.hero.z });
          },
          { rig, treatment },
        );
        await page.screenshot({
          path: path.join(directory!, `cohesion-${view}-${rig}-${treatment}.png`),
        });
      }
  }
});

test('requested forge and chapel cohesion comparisons', async ({ page }) => {
  const directory = process.env.LANTERN_COHESION_INTERIORS;
  test.skip(!directory, 'Explicit production-art review only');
  test.setTimeout(240_000);
  await mkdir(directory!, { recursive: true });
  for (const [fixture, x, z] of [
    ['forge', 3.5, 3],
    ['chapel', -0.5, -1.5],
  ] as const) {
    await page.goto(`/sandbox.html?scene=${fixture}-fixture`);
    await page.waitForFunction(() => window.foundation?.ready);
    if (!(await page.getByRole('button', { name: 'More options', exact: true }).isVisible()))
      await page.keyboard.press('Escape');
    await page.evaluate(
      ({ x, z }) => {
        const f = window.foundation;
        f.pause(true);
        f.editPreview((sim) => {
          Object.assign(sim.hero, { x, px: x, z, pz: z, yaw: Math.PI / 2 });
        });
      },
      { x, z },
    );
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('button', { name: 'Hide controls', exact: true }).click();
    for (const rig of ['lantern', 'silver'] as const)
      for (const enabled of [false, true]) {
        await page.evaluate(
          ({ rig, enabled }) => {
            const f = window.foundation;
            f.presentation.lookRenderer.setSettings({
              rig,
              paintedValues: enabled,
              paintedFinish: enabled,
              groundBounce: enabled,
              tightContacts: enabled,
            });
            f.presentation.update(f.sim, 1, 0, { x: f.sim.hero.x + 1, z: f.sim.hero.z });
          },
          { rig, enabled },
        );
        await page.screenshot({
          path: path.join(directory!, `${fixture}-${rig}-${enabled ? 'after' : 'before'}.png`),
        });
      }
  }
});

test('requested supplied-artwork comparison captures', async ({ page }) => {
  const directory = process.env.LANTERN_OPENING_CAPTURE_DIRECTORY;
  test.skip(!directory, 'Explicit visual review captures only');
  test.setTimeout(300_000);
  await mkdir(directory!, { recursive: true });
  for (const treatment of ['gust', 'leaves', 'combined']) {
    await page.goto(`/index.html?automated&wind-preview=${treatment}`);
    await page.locator('canvas[data-ready="true"]').waitFor();
    await page.locator('#menu-start').click();
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
    await page.locator('#menu-start').click();
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
  await page.locator('#menu-start').click();
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
    await page.locator('#menu-start').click();
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
  await page.locator('#menu-start').click();
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
