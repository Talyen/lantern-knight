import fs from 'node:fs/promises';
import path from 'node:path';
import { pixelTest as test, expect, openEditor, waitForEditorIdle } from './fixtures';
import { importEditorScene, expectEditorDocument } from './editor-driver';
import { content } from '../../src/content/game-content';

test.use({
  video: process.env.LANTERN_EXPLORATION_CAPTURES ? 'on' : 'off',
  actionTimeout: 30_000,
  viewport: { width: 800, height: 600 },
});

for (const area of content.definitions.areas) {
  test(`playable painting supports annotated floors and matching arrivals in ${area.id}`, async ({
    page,
  }, info) => {
    test.skip(!process.env.LANTERN_EXPLORATION_CAPTURES, 'Opt-in authored-scene review');
    test.setTimeout(420_000);
    const directory = process.env.LANTERN_EXPLORATION_CAPTURES ?? info.outputDir;
    await fs.mkdir(directory, { recursive: true });
    await openEditor(page);
    console.info('Exploration: loading', area.id);
    const document = JSON.parse(await fs.readFile(`authoring/scenes/${area.id}.json`, 'utf8'));
    await importEditorScene(page, document, area.id + '.json');
    await expectEditorDocument(page, (d) => d.name, { timeout: 180_000 }).toBe(
      'Imported ' + document.name,
    );
    await waitForEditorIdle(page);
    const renderer = await page.evaluate(() => {
      const gl = window.sceneEditor.view().presentation!.renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
    if (process.env.LANTERN_TEST_GPU === 'hardware')
      expect(renderer).not.toMatch(/swiftshader|llvmpipe|software/i);
    await fs.writeFile(path.join(directory, area.id + '-renderer.txt'), renderer);
    console.info('Exploration: renderer ready', area.id, renderer);
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
          ticks++;
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
          process.env.LANTERN_EXPLORATION_CAPTURES &&
          /arrival|departure|stairs|steps|terrace|altar|workshop|shed|room floor|raised/i.test(
            target.name,
          )
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
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            ready: window.sceneEditor.playtest()?.ready ?? false,
            tick: window.sceneEditor.playtest()?.tick,
            status: document.querySelector('#playtest-status')?.textContent,
          })),
        { timeout: 120_000 },
      )
      .toMatchObject({ ready: true });
    const before = await page.evaluate(() => window.sceneEditor.playtest()!.hero);
    await page.keyboard.down('w');
    await expect
      .poll(async () => {
        const now = await page.evaluate(() => window.sceneEditor.playtest()!.hero);
        return Math.hypot(now.x - before.x, now.z - before.z);
      })
      .toBeGreaterThan(0.15);
    await page.keyboard.up('w');
    // The selector contains authored annotations only; choose a real route in
    // each painting without depending on names from the original four areas.
    const routeIndex = document.groundInteraction.destinations.findIndex(
      (target: { x: number; z: number; reachable?: boolean }) =>
        target.reachable !== false && Math.hypot(target.x - before.x, target.z - before.z) > 1,
    );
    expect(routeIndex).toBeGreaterThanOrEqual(0);
    const target = targets[routeIndex]!;
    await page.locator('#movement-destination').selectOption(String(routeIndex));
    await expect
      .poll(
        () =>
          page.evaluate((target) => {
            const hero = window.sceneEditor.playtest()!.hero;
            return Math.hypot(hero.x - target.x, hero.z - target.z);
          }, target),
        { timeout: 180_000 },
      )
      .toBeLessThan(0.3);
    if (process.env.LANTERN_EXPLORATION_CAPTURES)
      await page.screenshot({ path: path.join(directory, area.id + '-walking.png') });
    await page.locator('#playtest-return').click();
    console.info('Exploration: keyboard complete', area.id);
    if (process.env.LANTERN_EXPLORATION_CAPTURES) {
      const video = page.video();
      await page.close();
      await video?.saveAs(path.join(directory, area.id + '-walking.webm'));
    }
  });
}
