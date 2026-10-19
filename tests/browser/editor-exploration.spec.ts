import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect, openEditor, waitForEditorIdle } from './fixtures';
import { importEditorScene, expectEditorDocument } from './editor-driver';
import { content } from '../../src/content/game-content';

test.use({ video: process.env.LANTERN_EXPLORATION_CAPTURES ? 'on' : 'off', actionTimeout: 30_000 });

test('playable paintings support their annotated floors and matching arrivals', async ({
  page,
}, info) => {
  test.setTimeout(900_000);
  const directory = process.env.LANTERN_EXPLORATION_CAPTURES ?? info.outputDir;
  await fs.mkdir(directory, { recursive: true });
  await openEditor(page);
  for (const area of content.definitions.areas) {
    console.info('Exploration: loading', area.id);
    const document = JSON.parse(await fs.readFile(`authoring/scenes/${area.id}.json`, 'utf8'));
    await importEditorScene(page, document, area.id + '.json');
    await expectEditorDocument(page, (d) => d.name, { timeout: 90_000 }).toBe(
      'Imported ' + document.name,
    );
    await waitForEditorIdle(page);
    console.info('Exploration: renderer ready', area.id);
    const targets = [
      ...document.groundInteraction.destinations,
      ...area.entries
        .filter((e) => !e.id.startsWith('fire-'))
        .map((e) => ({ ...e, name: 'arrival-' + e.id, reachable: true })),
      ...area.exits.map((e) => ({ ...e.marker, name: 'departure-' + e.id, reachable: true })),
    ] as { x: number; z: number; name: string; reachable: boolean }[];
    await page.evaluate(() => {
      const view = window.sceneEditor.view();
      view.setGrid(false);
      view.select(undefined);
      view.setAnimationPlaying(false);
      view.setGameCamera(true);
      view.sim!.movementPreview = true;
      for (const enemy of view.sim!.enemies) enemy.health = 0;
    });
    const observations = [];
    for (const target of targets) {
      const result = await page.evaluate((target) => {
        const view = window.sceneEditor.view(),
          sim = view.sim!,
          hero = sim.hero;
        sim.setMovementTarget(hero.id, target);
        let ticks = 0;
        while (ticks < 5000 && Math.hypot(hero.x - target.x, hero.z - target.z) > 0.16) {
          sim.step({ move: { x: 0, z: 0 }, aim: target });
          if (++ticks % 20 === 0) view.render(1000 / 60);
          if (
            sim.navigationDebug().routes.some((r) => r.id === hero.id && r.status === 'unreachable')
          )
            break;
        }
        view.render();
        return { distance: Math.hypot(hero.x - target.x, hero.z - target.z), ticks };
      }, target);
      observations.push({ name: target.name, ...result });
      if (target.reachable !== false) {
        expect(result.distance, `${area.id}: ${target.name}`).toBeLessThan(0.16);
        if (
          /arrival|departure|stairs|steps|terrace|altar|workshop|shed|room floor/i.test(target.name)
        ) {
          const image = await page.evaluate(() => {
            const view = window.sceneEditor.view();
            view.render();
            return view.canvas.toDataURL('image/png');
          });
          await fs.writeFile(
            path.join(directory, `${area.id}-${target.name.replace(/[^a-z0-9]+/gi, '-')}.png`),
            Buffer.from(image.split(',')[1]!, 'base64'),
          );
        }
      } else expect(result.distance).toBeGreaterThan(0.3);
    }
    await fs.writeFile(
      path.join(directory, area.id + '-routes.json'),
      JSON.stringify(observations, null, 2),
    );
    // The storage-free movement playtest exercises the actual keyboard input adapter.
    console.info('Exploration: routes complete', area.id);
    if ((await page.locator('#play-action > details').getAttribute('open')) === null)
      await page.locator('#play-action > details > summary').click();
    await page.locator('#test-movement').click();
    await page.waitForFunction(() => window.sceneEditor.playtest()?.ready, undefined, {
      timeout: 120_000,
    });
    const before = await page.evaluate(() => window.sceneEditor.playtest()!.hero);
    await page.keyboard.down('w');
    await expect
      .poll(async () => {
        const now = await page.evaluate(() => window.sceneEditor.playtest()!.hero);
        return Math.hypot(now.x - before.x, now.z - before.z);
      })
      .toBeGreaterThan(0.15);
    await page.keyboard.up('w');
    const routeIndex = targets.findIndex((target) =>
      /^(Shed interior|Ritual steps|Workshop entrance|Southern stairs)$/i.test(target.name),
    );
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    const target = targets[routeIndex]!;
    await page.locator('#movement-destination').selectOption(String(routeIndex));
    await page.waitForFunction(
      (target) => {
        const hero = window.sceneEditor.playtest()!.hero;
        return Math.hypot(hero.x - target.x, hero.z - target.z) < 0.3;
      },
      target,
      { timeout: 90_000 },
    );
    await page.screenshot({ path: path.join(directory, area.id + '-walking.png') });
    await page.locator('#playtest-return').click();
    console.info('Exploration: keyboard complete', area.id);
  }
  if (process.env.LANTERN_EXPLORATION_CAPTURES) {
    const video = page.video();
    await page.close();
    await video?.saveAs(path.join(directory, 'walking.webm'));
  }
});
