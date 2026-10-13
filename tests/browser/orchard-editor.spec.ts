import { test, expect, openEditor } from './fixtures';

test('editor authors campfires, local encounters, rewards and explicit departures', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#scene-tab').click();
  await page.locator('[data-section="category-Gameplay"] > summary').click();
  await page.locator('[data-section="gameplay.campfires"] > summary').click();
  await page.getByRole('button', { name: 'Add Campfires', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.sceneEditor.state().document.gameplay?.campfires?.length),
    )
    .toBe(1);
  await page.locator('[data-section="gameplay.spawns"] > summary').click();
  await page.getByRole('button', { name: 'Add Enemies', exact: true }).click();
  await page.locator('[data-section="gameplay.spawns.0"] > summary').click();
  await page.locator('[data-section="gameplay.spawns.0.awareness"] > summary').click();
  const group = page.locator('[data-field="gameplay.spawns.0.awareness.group"]');
  await group.fill('final-pair');
  await group.dispatchEvent('change');
  await page.locator('[data-section="gameplay.spawns.0.rewards"] > summary').click();
  await page.getByRole('button', { name: 'Add Rewards', exact: true }).click();
  await page.locator('[data-section="gameplay.exits"] > summary').click();
  await page.getByRole('button', { name: 'Add Exits', exact: true }).click();
  const gameplay = await page.evaluate(() => window.sceneEditor.state().document.gameplay!);
  expect(gameplay.campfires![0]!.safeRadius).toBe(2.6);
  expect(gameplay.spawns[0]!.awareness).toEqual({ radius: 3.3, leash: 5.8, group: 'final-pair' });
  expect(gameplay.spawns[0]!.rewards).toEqual([{ item: 'gold', amount: 3 }]);
  expect(gameplay.exits[0]!.explicit).toBe(true);
  expect(gameplay.exits[0]!.guards).toEqual([]);
});
