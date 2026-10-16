import { importEditorScene, expectEditorDocument } from './editor-driver';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect, openEditor, waitForEditorIdle } from './fixtures';
import { projectRoot } from '../../tools/assets/paths';
import type { SceneDocument } from '../../src/content/scene-document';

test('opening scene composition rejects hidden bodies and preserves readable placements', async ({
  page,
}) => {
  test.skip(
    !process.env.LANTERN_ORCHARD_DESIGN_CAPTURES,
    'Explicit opening composition captures only',
  );
  test.setTimeout(360_000);
  const scene = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'authoring/scenes/abandoned-orchard.json'), 'utf8'),
  );
  await openEditor(page);
  await importEditorScene(page, scene, 'orchard.json');
  await expectEditorDocument(page, (document) => document.name, { timeout: 90_000 }).toBe(
    'Imported ' + scene.name,
  );
  await waitForEditorIdle(page);
  const result = await page.evaluate(async () => {
    const source = '/src/content/floor-layout.ts';
    const { artworkFloorLayout } = await import(source);
    const original = window.sceneEditor.state().document;
    const bad = structuredClone(original) as SceneDocument;
    // Feet were accepted here by the old policy; the head intersects the apple canopy.
    bad.gameplay!.spawns[0]!.x = -9.5;
    bad.gameplay!.spawns[0]!.z = 5.75;
    let error = '';
    try {
      await window.sceneEditor.view().apply(bad);
    } catch (e) {
      error = (e as Error).message;
    }
    const view = window.sceneEditor.view();
    return {
      error,
      available: !!view.presentation,
      unchanged: JSON.stringify(original) === JSON.stringify(window.sceneEditor.state().document),
      foot: artworkFloorLayout(original.floor.width, original.floor.depth).uv({ x: -9.5, z: 5.75 }),
    };
  });
  expect(result.error).toContain('registered artwork overlaps painted scenery');
  expect(result.available).toBe(true);
  expect(result.unchanged).toBe(true);
  const directory = process.env.LANTERN_ORCHARD_DESIGN_CAPTURES;
  if (!directory) return;
  await fs.mkdir(directory, { recursive: true });
  await page.locator('#viewport').focus();
  await page.keyboard.press('Tab');
  await page.evaluate(() => {
    window.sceneEditor.view().setGrid(false);
    window.sceneEditor.view().setAnimationPlaying(false);
  });
  for (const [name, u, v, span] of [
    ['whole-orchard', 0.5, 0.5, 21.3333333333333],
    ['camp-verge', 0.455, 0.76, 8.55],
    ['western-picking', 0.35, 0.51, 8.55],
    ['press-apron', 0.61, 0.36, 8.55],
    ['harvest-apron', 0.68, 0.72, 8.55],
    ['eastern-passage', 0.79, 0.6, 8.55],
  ] as const) {
    await page.evaluate(
      async ({ u, v, span }) => {
        const source = '/src/content/floor-layout.ts';
        const { artworkFloorLayout } = await import(source);
        const view = window.sceneEditor.view(),
          d = window.sceneEditor.state().document,
          p = view.presentation!;
        const center = artworkFloorLayout(d.floor.width, d.floor.depth).world([u, v]);
        view.hero(d.hero);
        p.center.set(center.x, 0, center.z);
        p.verticalSpan = span;
        p.resize();
        view.render();
      },
      { u, v, span },
    );
    for (const rig of ['lantern', 'silver'] as const) {
      await page.evaluate((rig) => {
        const view = window.sceneEditor.view();
        view.presentation!.lookRenderer.setSettings({ rig });
        view.render();
      }, rig);
      await page.waitForTimeout(250);
      await page.screenshot({
        path: path.join(directory, `${name}${rig === 'silver' ? '-silver' : ''}.png`),
      });
    }
  }
  for (const [name, dx, dz] of [
    ['wagon-lantern-left', -2, 0],
    ['wagon-lantern-right', 0.6, -2.1],
  ] as const) {
    await page.evaluate(
      ({ dx, dz }) => {
        const view = window.sceneEditor.view(),
          document = window.sceneEditor.state().document,
          p = view.presentation!;
        const cart = document.objects.find((o) => o.id === 'harvest-handcart')!;
        view.hero({ x: cart.x! + dx, z: cart.z! + dz });
        p.center.set(cart.x!, 0, cart.z!);
        p.verticalSpan = 8.55;
        p.resize();
        p.lookRenderer.setSettings({ rig: 'lantern' });
        view.render();
      },
      { dx, dz },
    );
    await page.screenshot({ path: path.join(directory, `${name}.png`) });
  }
  for (const id of ['forest-gathering-clearing', 'ruined-forge', 'desecrated-chapel']) {
    const destination = JSON.parse(
      await fs.readFile(path.join(projectRoot, 'authoring/scenes', id + '.json'), 'utf8'),
    );
    await page.locator('#import-scene').setInputFiles({
      name: id + '.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(destination)),
    });
    await page.locator('#confirmation-accept').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.name), {
        timeout: 90_000,
      })
      .toBe('Imported ' + destination.name);
    await waitForEditorIdle(page);
    await page.evaluate(async () => {
      const source = '/src/content/floor-layout.ts';
      const { artworkFloorLayout } = await import(source);
      const view = window.sceneEditor.view(),
        d = window.sceneEditor.state().document,
        p = view.presentation!;
      view.setGrid(false);
      view.setAnimationPlaying(false);
      view.hero(d.hero);
      const center = artworkFloorLayout(d.floor.width, d.floor.depth).world([0.5, 0.5]);
      p.center.set(center.x, 0, center.z);
      p.verticalSpan = d.floor.depth * 1.1;
      p.resize();
      view.render();
    });
    await page.screenshot({ path: path.join(directory, id + '-composition.png') });
    if (id !== 'desecrated-chapel') continue;
    for (const [index, heading] of ['d00', 'd90', 'd180', 'd270'].entries()) {
      for (const [state, age] of [
        ['idle', 0],
        ['walk', 0],
        ['attack', 59],
        ['attack', 60],
        ['hurt', 5],
        ['death', 25],
      ] as const) {
        await page.evaluate(
          ({ index, heading, state, age }) => {
            const view = window.sceneEditor.view(),
              p = view.presentation!,
              warden = view.sim!.enemies.find((a) => a.definition.id === 'chapel-warden')!;
            view.hero({ x: warden.x + 2, z: warden.z + 1.5 });
            Object.assign(warden, {
              state,
              age,
              health: state === 'death' ? 0 : 130,
              action: warden.action + 1,
              yaw: (index * Math.PI) / 2,
              actionHeading: heading,
            });
            p.center.set(warden.x, 0, warden.z);
            p.verticalSpan = 7;
            p.resize();
            view.render(state === 'walk' ? 150 : 0);
          },
          { index, heading, state, age },
        );
        await page.screenshot({
          path: path.join(directory, `warden-${heading}-${state}-${age}.png`),
        });
      }
    }
  }
});
