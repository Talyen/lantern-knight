import {
  changeField,
  importEditorScene,
  readEditorDocument,
  expectEditorDocument,
} from './editor-driver';
import { test, expect, openEditor, waitForEditorIdle } from './fixtures';
import { defaultCampfireAsset } from '../../src/content/campfire-visuals';
import { emptyScene } from '../../src/editor/default-scene';

test('editor authors campfires, local encounters, rewards and explicit departures', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#scene-tab').click();
  await page.locator('[data-section="category-Gameplay"] > summary').click();
  await page.locator('[data-section="gameplay.campfires"] > summary').click();
  await page.getByRole('button', { name: 'Add Campfires', exact: true }).click();
  await expectEditorDocument(page, (document) => document.gameplay?.campfires?.length).toBe(1);
  expect(
    await page.evaluate(
      (asset) =>
        window.sceneEditor
          .view()
          .presentation!.roomPresentation.inkRoom!.sprites.filter(
            (s) => s.manifest.asset.id === asset,
          ).length,
      defaultCampfireAsset,
    ),
  ).toBe(1);
  await page.locator('[data-section="gameplay.spawns"] > summary').click();
  await page.getByRole('button', { name: 'Add Enemies', exact: true }).click();
  await page.locator('[data-section="gameplay.spawns.0"] > summary').click();
  await page.locator('[data-section="gameplay.spawns.0.advanced"] > summary').click();
  await page.locator('[data-section="gameplay.spawns.0.awareness"] > summary').click();
  const group = page.locator('[data-field="gameplay.spawns.0.awareness.group"]');
  await changeField(group, 'final-pair');
  await page.locator('[data-section="gameplay.spawns.0.rewards"] > summary').click();
  await page.getByRole('button', { name: 'Add Rewards', exact: true }).click();
  await page.locator('[data-section="gameplay.exits"] > summary').click();
  await page.getByRole('button', { name: 'Add Exits', exact: true }).click();
  const gameplay = await readEditorDocument(page, (document) => document.gameplay!);
  expect(gameplay.campfires![0]!.safeRadius).toBe(2.6);
  expect(gameplay.spawns[0]!.awareness).toEqual({ radius: 3.3, leash: 5.8, group: 'final-pair' });
  expect(gameplay.spawns[0]!.rewards).toEqual([{ item: 'gold', amount: 3 }]);
  expect(gameplay.exits[0]!.explicit).toBe(true);
  expect(gameplay.exits[0]!.guards).toEqual([]);
});

test('gameplay inspector moves linked artwork and creates valid container and guard references', async ({
  page,
}) => {
  await openEditor(page);
  const scene = emptyScene();
  scene.hero = { x: -3, z: -3 };
  scene.objects = [
    { id: 'supplies', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 1, z: 1 },
  ];
  scene.gameplay!.pickups = [
    { id: 'health', object: 'supplies', kind: 'health', x: 0, z: 0, amount: 25, radius: 0.5 },
  ];
  scene.gameplay!.spawns = [{ id: 'warden', actor: 'skeleton', x: -4, z: -4 }];
  await importEditorScene(page, scene, 'authoring-regression.json');
  await expectEditorDocument(page, (document) => document.objects[0]?.id, {
    timeout: 60_000,
  }).toBe('supplies');
  await waitForEditorIdle(page);
  await page.locator('#scene-tab').click();
  await page.locator('[data-section="category-Gameplay"] > summary').click();
  await page.locator('[data-section="gameplay.pickups"] > summary').click();
  await page.locator('[data-section="gameplay.pickups.0"] > summary').click();
  const x = page.locator('[data-field="gameplay.pickups.0.x"]');
  await expect(page.locator('[data-field="gameplay.pickups.0.z"]')).toHaveValue('1');
  await changeField(x, '3');
  await expectEditorDocument(page, (document) => document.objects[0]!.x).toBe(3);
  expect(
    await page.evaluate(() => window.sceneEditor.view().sim!.areaDefinition.pickups![0]!.x),
  ).toBe(3);
  await page.locator('#undo').click();
  await expectEditorDocument(page, (document) => document.objects[0]!.x).toBe(1);
  await page.locator('[data-section="gameplay.interactables"] > summary').click();
  await page.getByRole('button', { name: 'Add Interactables', exact: true }).click();
  await expectEditorDocument(page, (document) => document.gameplay!.interactables?.length).toBe(1);
  await page.locator('[data-section="gameplay.interactables.0"] > summary').click();
  await page.locator('[data-section="gameplay.interactables.0.advanced"] > summary').click();
  await page.locator('[data-section="gameplay.interactables.0.guards"] > summary').click();
  await page.getByRole('button', { name: 'Add Guards', exact: true }).click();
  await expectEditorDocument(
    page,
    (document) => document.gameplay!.interactables![0]!.guards,
  ).toEqual(['warden']);
  const interaction = await readEditorDocument(
    page,
    (document) => document.gameplay!.interactables![0]!,
  );
  await changeField(page.locator('[data-field="gameplay.interactables.0.x"]'), '3');
  await expectEditorDocument(page, (document) => document.objects[0]!.x).toBe(3);
  expect(
    await page.evaluate(() => window.sceneEditor.view().sim!.areaDefinition.interactables![0]!.x),
  ).toBe(3);
  await page.locator('#undo').click();
  await expectEditorDocument(page, (document) => document.objects[0]!.x).toBe(1);
  expect([interaction.idle, interaction.action, interaction.spent]).toEqual([
    'lantern',
    'lantern',
    'lantern',
  ]);
});
