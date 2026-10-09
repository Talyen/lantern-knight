import { test, expect } from './fixtures';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../tools/assets/paths';
import type {} from '../../src/editor/main';
test('editor placement, experimental scale, history, recovery, save and external conflict', async ({
  page,
  request,
  errors,
}) => {
  const id = 'prototype-' + Date.now(),
    file = path.join(projectRoot, 'authoring/scenes', id + '.json');
  try {
    await page.goto('/editor.html');
    await page.waitForFunction(() => window.sceneEditor?.ready());
    const initial = await page.evaluate(() => window.sceneEditor.state().document);
    await page.locator('#name').fill('Prototype recovery');
    await page.locator('#name').dispatchEvent('change');
    await page.locator('#undo').click();
    expect((await page.evaluate(() => window.sceneEditor.state().document)).name).toBe(
      initial.name,
    );
    await page.locator('#redo').click();
    await page.reload();
    await page.waitForFunction(() => window.sceneEditor?.ready());
    await expect(page.locator('#recovery')).toBeVisible();
    await page.locator('#restore').click();
    await page.locator('#search').fill('ink-scenery');
    await page.getByTitle('ink-scenery/arch', { exact: true }).click();
    await page.locator('#place-clip').selectOption('gravestone');
    await page.locator('#viewport').click({ position: { x: 350, y: 280 } });
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(1);
    await page.locator('#scale').fill('2');
    await page.locator('#scale').dispatchEvent('change');
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects[0]!.scale))
      .toBe(2);
    await page.locator('#undo').click();
    expect(await page.evaluate(() => window.sceneEditor.state().document.objects[0]!.scale)).toBe(
      1,
    );
    await page.locator('#redo').click();
    await page.locator('#save-as').click();
    await page.locator('#file-id').fill(id);
    await page.locator('#confirm-save').click();
    await expect(page.locator('#save-state')).toHaveText('Saved');
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.objects[0].scale).toBe(2);
    expect(saved.version).toBe(5);
    expect(errors).toEqual([]);
    await fs.writeFile(file, JSON.stringify({ ...saved, name: 'External change' }));
    await page.locator('#name').fill('Preserved draft');
    await page.locator('#name').dispatchEvent('change');
    await page.locator('#save').click();
    await expect(page.locator('#conflict')).toBeVisible();
    const expectedConflict =
      'Failed to load resource: the server responded with a status of 409 (Conflict)';
    await expect.poll(() => errors.filter((error) => error === expectedConflict).length).toBe(1);
    errors.splice(errors.indexOf(expectedConflict), 1);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).name).toBe('External change');
    expect((await page.evaluate(() => window.sceneEditor.state().document)).name).toBe(
      'Preserved draft',
    );
    const data = await (await request.get('/__lantern_editor')).json();
    const denied = await request.post('/__lantern_editor', {
      data: { document: initial, revision: null, baseRevision: data.baseRevision },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await fs.rm(file, { force: true });
  }
});

test('editor multi-selection, inspector, palette grouping and editor-only visibility', async ({
  page,
}) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.locator('#search').fill('ink-scenery');
  await page.getByTitle('ink-scenery/arch', { exact: true }).click();
  await expect(page.locator('#assets .asset')).toHaveCount(1);
  await page.locator('#place-clip').selectOption('gravestone');
  await page.locator('#viewport').click({ position: { x: 300, y: 250 } });
  await expect(page.locator('#object-panel')).toBeVisible();
  await page.locator('#duplicate').click();
  await expect(page.locator('.object-row')).toHaveCount(2);
  await page
    .locator('.object-select')
    .first()
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('#selected-name')).toContainText('2 objects selected');
  const before = await page.evaluate(() =>
    window.sceneEditor.state().document.objects.map((p) => p.x),
  );
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.map((p) => p.x)))
    .toEqual(before.map((v) => v! + 0.5));
  await page.locator('#undo').click();
  expect(
    await page.evaluate(() => window.sceneEditor.state().document.objects.map((p) => p.x)),
  ).toEqual(before);
  await page.locator('.object-row').first().getByRole('button', { name: /Hide/ }).click();
  expect((await page.evaluate(() => window.sceneEditor.state().document)).objects).toHaveLength(2);
  await page.locator('#scene-tab').click();
  await expect(page.locator('#scene-panel')).toBeVisible();
  await page.locator('#grid').check();
  await expect(page.locator('#snap')).not.toBeChecked();
});
