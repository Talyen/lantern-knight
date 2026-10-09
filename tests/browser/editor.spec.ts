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
    .locator('.object-select:not(.active)')
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

test('visual authoring, independent fragments, pattern undo and import', async ({
  page,
  request,
}) => {
  const before = (await (await request.get('/__lantern_editor?fragments')).json()).fragments.map(
    (p: { id: string }) => p.id,
  ) as string[];
  try {
    await page.goto('/editor.html?automated');
    await page.waitForFunction(() => window.sceneEditor?.ready());
    await page
      .locator('#scene-panel')
      .getByRole('button', { name: 'Add paths', exact: true })
      .click();
    await page.locator('#visual-fields').getByText('paths 1', { exact: true }).click();
    const width = page.locator('[data-field="paths.0.width"]');
    await width.fill('2');
    await width.dispatchEvent('change');
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.paths[0]?.width))
      .toBe(2);
    await page.locator('#tool').selectOption('geometry');
    await page.locator('#search').fill('ink-scenery');
    await page.getByTitle('ink-scenery/arch', { exact: true }).click();
    await page.locator('#place-clip').selectOption('gravestone');
    await page.locator('#viewport').click({ position: { x: 350, y: 230 } });
    await page.locator('#scene-library').click();
    await page.locator('#fragment-name').fill('Browser test arrangement');
    await page.locator('#save-fragment').click();
    await expect(page.locator('#library-fragments')).toContainText('Browser test arrangement');
    await page
      .locator('#library-fragments')
      .getByRole('button', { name: 'Browser test arrangement · 1 objects', exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(2);
    expect(
      await page.evaluate(
        () => new Set(window.sceneEditor.state().document.objects.map((p) => p.id)).size,
      ),
    ).toBe(2);
    await page.locator('#scene-tab').click();
    await page.locator('#pattern-count').fill('2');
    await page.locator('#pattern-preview').click();
    await page.locator('#pattern-apply').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(4);
    await page.locator('#undo').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(2);
    const imported = await page.evaluate(() => window.sceneEditor.state().document);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.locator('#import-scene').setInputFiles({
      name: 'scene.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.name))
      .toContain('Imported');
    expect((await page.evaluate(() => window.sceneEditor.state())).revision).toBeNull();
  } finally {
    const fragments = (await (await request.get('/__lantern_editor?fragments')).json())
      .fragments as { id: string }[];
    for (const p of fragments)
      if (!before.includes(p.id))
        await fs.rm(path.join(projectRoot, 'authoring/fragments', p.id + '.json'), { force: true });
  }
});

test('unsaved draft playtest discards gameplay state and survives repeated entry', async ({
  page,
}) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.locator('#name').fill('Unsaved playtest');
  await page.locator('#viewport').focus();
  await expect(page.locator('#save-state')).toHaveText('Unsaved');
  const before = await page.evaluate(() => ({
    document: window.sceneEditor.state().document,
    storage: JSON.stringify(
      Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, i) => {
          const key = localStorage.key(i)!;
          return [key, localStorage.getItem(key)];
        }).sort((a, b) => a[0]!.localeCompare(b[0]!)),
      ),
    ),
  }));
  for (let i = 0; i < 2; i++) {
    await page.locator('#play-from-here').click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.sceneEditor.playtest()?.ready
              ? 'ready'
              : document.getElementById('validation-errors')?.textContent || 'loading',
          ),
        { timeout: 20000 },
      )
      .toBe('ready');
    await page.locator('#playtest-viewport').focus();
    await page.keyboard.down('KeyD');
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.playtest()?.hero.x))
      .not.toBe(before.document.hero.x);
    await page.keyboard.up('KeyD');
    await page.locator('#playtest-return').click();
    await expect(page.locator('#playtest-dialog')).not.toBeVisible();
    expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before.document);
    expect(
      await page.evaluate(() =>
        JSON.stringify(
          Object.fromEntries(
            Array.from({ length: localStorage.length }, (_, i) => {
              const key = localStorage.key(i)!;
              return [key, localStorage.getItem(key)];
            }).sort((a, b) => a[0]!.localeCompare(b[0]!)),
          ),
        ),
      ),
    ).toEqual(before.storage);
    expect(await page.evaluate(() => window.sceneEditor.playtest())).toBeUndefined();
  }
});
