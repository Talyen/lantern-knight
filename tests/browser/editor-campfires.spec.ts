import fs from 'node:fs/promises';
import path from 'node:path';
import { stateTest as test, expect, openEditor, waitForEditorIdle } from './fixtures';
import { changeField, importEditorScene, expectEditorDocument } from './editor-driver';
import { defaultCampfireAsset } from '../../src/content/campfire-visuals';
import { emptyScene } from '../../src/editor/default-scene';
import { projectRoot } from '../../tools/assets/paths';

test('campfire defaults render the supplied animation and light in every playable scene', async ({
  page,
}) => {
  test.setTimeout(360_000);
  await openEditor(page);
  const fixture = emptyScene();
  fixture.gameplay!.campfires = [{ id: 'rest', name: 'Rest', x: 0, z: 0, safeRadius: 2.6 }];
  const ids = process.env.LANTERN_CAMPFIRE_CAPTURES
    ? ['abandoned-orchard', 'forest-gathering-clearing', 'ruined-forge', 'desecrated-chapel']
    : [];
  for (const id of ['fixture', ...ids]) {
    const document =
      id === 'fixture'
        ? fixture
        : JSON.parse(
            await fs.readFile(path.join(projectRoot, 'authoring/scenes', id + '.json'), 'utf8'),
          );
    await importEditorScene(page, document);
    await expectEditorDocument(page, (d) => d.name, { timeout: 90_000 }).toBe(
      'Imported ' + document.name,
    );
    await waitForEditorIdle(page);
    await expect(page.locator('#validation-errors')).toBeEmpty();
    const result = await page.evaluate((asset) => {
      const view = window.sceneEditor.view(),
        p = view.presentation!,
        fire = view.sim!.areaDefinition.campfires![0]!;
      const sprites = p.roomPresentation.inkRoom!.sprites.filter(
        (s) => s.manifest.asset.id === asset,
      );
      view.setGrid(false);
      view.setAnimationPlaying(false);
      view.hero({ x: fire.x + 1.1, z: fire.z });
      view.select(undefined);
      p.gameCamera = false;
      p.center.set(fire.x, 0, fire.z);
      p.verticalSpan = 6;
      p.resize();
      view.render(0);
      const first = sprites[0]!;
      const clip = first.manifest.asset.clips.loop!.d45!;
      const gl = p.renderer.getContext();
      return {
        lights: p.visuals!.resolvedFixtures!.filter((f) => f.prop === 'campfire-' + fire.id).length,
        count: sprites.length,
        frames: clip.frames.length,
        duration: clip.durationsMs.reduce((a, b) => a + b, 0),
        error: gl.getError(),
      };
    }, defaultCampfireAsset);
    expect(result).toEqual({ lights: 1, count: 1, frames: 16, duration: 1600, error: 0 });
    const captures = process.env.LANTERN_CAMPFIRE_CAPTURES;
    if (captures && id !== 'fixture') {
      await fs.mkdir(captures, { recursive: true });
      await page.locator('#viewport').screenshot({ path: path.join(captures, id + '.png') });
    }
  }
});

for (const shared of [false, true]) {
  test(`custom campfire conversion preserves ${shared ? 'shared' : 'exclusive'} artwork ownership`, async ({
    page,
  }) => {
    await openEditor(page);
    const scene = emptyScene();
    scene.objects.push({
      id: 'custom-fire',
      kind: 'prop',
      asset: defaultCampfireAsset,
      clip: 'unlit',
      x: 1,
      z: 1,
    });
    scene.gameplay!.campfires = [
      { id: 'rest', name: 'Rest', object: 'custom-fire', x: 0, z: 0, safeRadius: 2.6 },
    ];
    if (shared)
      scene.gameplay!.pickups.push({
        id: 'shared-pickup',
        object: 'custom-fire',
        x: 1,
        z: 1,
        kind: 'health',
        amount: 25,
        radius: 0.4,
      });
    await importEditorScene(page, scene);
    await expectEditorDocument(page, (d) => d.name).toBe('Imported ' + scene.name);
    await waitForEditorIdle(page);
    await page.locator('#scene-tab').click();
    await page.locator('[data-section="category-Gameplay"] > summary').click();
    await page.locator('[data-section="gameplay.campfires"] > summary').click();
    await page.locator('[data-section="gameplay.campfires.0"] > summary').click();
    await expect(page.locator('[data-field="gameplay.campfires.0.x"]')).toHaveValue('1');
    await changeField(page.locator('[data-field="gameplay.campfires.0.x"]'), '3');
    await expectEditorDocument(page, (d) => d.objects[0]!.x).toBe(3);
    await page.getByRole('button', { name: 'Use default campfire', exact: true }).click();
    await expectEditorDocument(page, (d) => d.objects.length).toBe(shared ? 1 : 0);
    if (shared)
      await expectEditorDocument(page, (d) => d.gameplay!.pickups).toMatchObject([
        { id: 'shared-pickup', object: 'custom-fire' },
      ]);
    await expectEditorDocument(page, (d) => d.gameplay!.campfires![0]).toMatchObject({
      x: 3,
      z: 1,
    });
    await waitForEditorIdle(page);
    const result = await page.evaluate(() => {
      const view = window.sceneEditor.view();
      return {
        count: view.presentation!.roomPresentation.inkRoom!.sprites.filter(
          (s) => s.id === 'campfire-rest',
        ).length,
        x: view.sim!.areaDefinition.campfires![0]!.x,
      };
    });
    expect(result).toEqual({ count: 1, x: 3 });
  });
}
