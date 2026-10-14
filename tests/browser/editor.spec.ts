import { readJson, writeJson } from '../../tools/json-file';
import { test, expect, openEditor, waitForEditor, waitForEditorIdle } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../tools/assets/paths';
import type {} from '../../src/editor/main';
import { sceneFixture } from '../fixtures/scene';
async function chooseGravestone(page: Page) {
  await page.locator('#artwork-tab').click();
  await page.locator('#search').fill('ink-scenery');
  await page.getByTitle('ink-scenery/arch', { exact: true }).click();
  await page.locator('#place-clip').selectOption('gravestone');
}
test('editor placement, experimental scale, history, recovery, save and external conflict', async ({
  page,
  request,
  errors,
}) => {
  const id = 'prototype-' + Date.now(),
    file = path.join(projectRoot, 'authoring/scenes', id + '.json');
  try {
    const nativeDialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      nativeDialogs.push(dialog.type());
      await dialog.dismiss();
    });
    await openEditor(page, '/editor.html');
    const initial = await page.evaluate(() => window.sceneEditor.state().document);
    expect(initial.look).toEqual({
      rig: 'lantern',
      look: 'cinematic',
      sun: { azimuthDeg: 20, elevationDeg: 15 },
    });
    await page.locator('#name').fill('Prototype recovery');
    await page.locator('#name').dispatchEvent('change');
    await page.locator('#undo').click();
    expect((await page.evaluate(() => window.sceneEditor.state().document)).name).toBe(
      initial.name,
    );
    await page.locator('#redo').click();
    await page.locator('#document-menu > summary').click();
    await page.locator('#new-scene').click();
    await expect(page.getByRole('dialog', { name: 'Confirm action' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    expect((await page.evaluate(() => window.sceneEditor.state().document)).name).toBe(
      'Prototype recovery',
    );
    await page.locator('#document-menu > summary').click();
    await page.locator('#new-scene').click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.reload();
    await waitForEditor(page);
    expect(nativeDialogs).toEqual([]);
    await expect(page.locator('#recovery')).toBeVisible();
    await page.locator('#restore').click();
    expect(await page.evaluate(() => window.sceneEditor.state().document.look)).toEqual(
      initial.look,
    );
    await chooseGravestone(page);
    await page.locator('#viewport').click({ position: { x: 350, y: 280 } });
    await waitForEditorIdle(page);
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(1);
    await page.locator('#scale').fill('2');
    await page.locator('#scale').dispatchEvent('change');
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects[0]!.scale))
      .toBe(2);
    // Reject after the view has already replaced its room. History and recovery must
    // retain the accepted scene, and the old room must be restored for retry.
    const snapshot = () =>
      page.evaluate(() => ({
        document: window.sceneEditor.state().document,
        scale: window.sceneEditor
          .view()
          .presentation!.roomPresentation.inkRoom!.sprites.find(
            (sprite) => sprite.id === window.sceneEditor.state().document.objects[0]!.id,
          )!
          .mesh.scale.toArray(),
        recovery: Object.entries(localStorage).filter(([key]) =>
          key.startsWith('lantern-scene-editor-recovery:'),
        ),
      }));
    const accepted = await snapshot();
    await page.evaluate(() => {
      const renderer = window.sceneEditor.view().presentation!.lookRenderer;
      const prepare = renderer.prepare.bind(renderer);
      renderer.prepare = async () => {
        renderer.prepare = prepare;
        throw new Error('Lighting update rejected');
      };
    });
    await page.locator('#undo').click();
    await expect(page.locator('#status')).toHaveText('Lighting update rejected');
    expect(await snapshot()).toEqual(accepted);
    expect(
      await page.evaluate(
        () => window.sceneEditor.view().presentation!.visualOverride!.props[0]!.scale,
      ),
    ).toBe(2);
    await page.locator('#undo').click();
    expect(await page.evaluate(() => window.sceneEditor.state().document.objects[0]!.scale)).toBe(
      1,
    );
    await page.locator('#redo').click();
    await page.locator('#document-menu > summary').click();
    await page.locator('#save-as').click();
    await page.locator('#file-id').fill(id);
    const saving = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/__lantern_editor' &&
        response.request().method() === 'POST',
    );
    await page.locator('#confirm-save').click();
    expect((await saving).status()).toBe(200);
    // Saving also refreshes the scene list before releasing the editor's busy state.
    await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 30000 });
    const saved = await readJson(file);
    expect(saved.objects[0].scale).toBe(2);
    expect(saved.version).toBe(5);
    expect(errors).toEqual([]);
    await writeJson(file, { ...saved, name: 'External change' });
    await page.locator('#name').fill('Preserved draft');
    await page.locator('#name').dispatchEvent('change');
    await page.locator('#save').click();
    await expect(page.locator('#conflict')).toBeVisible();
    const expectedConflict =
      'Failed to load resource: the server responded with a status of 409 (Conflict)';
    await expect.poll(() => errors.filter((error) => error === expectedConflict).length).toBe(1);
    errors.splice(errors.indexOf(expectedConflict), 1);
    expect((await readJson(file)).name).toBe('External change');
    expect((await page.evaluate(() => window.sceneEditor.state().document)).name).toBe(
      'Preserved draft',
    );
    await page.locator('#reload').click();
    await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
    await expect(page.locator('#name')).toHaveValue('External change', { timeout: 30000 });
    await expect(page.locator('#save-state')).toHaveText('Saved');
    expect(nativeDialogs).toEqual([]);
    const data = await (await request.get('/__lantern_editor')).json();
    const denied = await request.post('/__lantern_editor', {
      data: { document: initial, revision: null, baseRevision: data.baseRevision },
    });
    expect(denied.status()).toBe(403);
    const invalidId = 'invalid-surround-' + Date.now();
    const invalid = await request.post('/__lantern_editor', {
      headers: { 'X-Lantern-Editor-Token': data.token },
      data: {
        document: {
          ...initial,
          id: invalidId,
          surround: {
            anchor: { x: 0, z: 0 },
            color: 0,
            ground: [
              { x: 0, z: 0 },
              { x: 1, z: 0 },
              { x: 0, z: 1 },
            ],
            layers: [
              {
                asset: 'missing-surround',
                clip: 'still',
                scale: 1,
                base: 0,
                parallax: 0,
                tint: 0xffffff,
                detail: 0,
              },
            ],
          },
        },
        revision: null,
        baseRevision: data.baseRevision,
      },
    });
    expect(invalid.status()).toBe(400);
    expect(
      (await (await request.get('/__lantern_editor?id=' + invalidId)).json()).document,
    ).toBeNull();
  } finally {
    await fs.rm(file, { force: true });
  }
});

test('editor multi-selection, inspector, palette grouping and editor-only visibility', async ({
  page,
}) => {
  await openEditor(page);
  await chooseGravestone(page);
  await expect(page.locator('#assets .asset')).toHaveCount(1);
  await page.locator('#viewport').click({ position: { x: 300, y: 250 } });
  await waitForEditorIdle(page);
  await expect(page.locator('#object-panel')).toBeVisible();
  await page.locator('#duplicate').click();
  await expect(page.locator('.object-row')).toHaveCount(2);
  await page.locator('#objects-tab').click();
  const first = page.locator('.object-row').first();
  await first.locator('.object-select').click();
  await page.locator('#objects-tab').click();
  const unlocked = await page.evaluate(() => window.sceneEditor.state().document);
  await first.getByRole('button', { name: /^Lock / }).click();
  await expect(page.locator('#x')).toBeDisabled();
  await expect(page.locator('#delete')).toBeDisabled();
  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(unlocked);
  await first.getByRole('button', { name: /^Unlock / }).click();
  await expect(page.locator('#x')).toBeEnabled();
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
  await page.locator('#objects-tab').click();
  await page.locator('.object-row').first().getByRole('button', { name: /Hide/ }).click();
  expect((await page.evaluate(() => window.sceneEditor.state().document)).objects).toHaveLength(2);
  await expect
    .poll(() =>
      page.evaluate(() => window.sceneEditor.view().presentation!.visualOverride!.props.length),
    )
    .toBe(1);
  await page.locator('#scene-tab').click();
  await expect(page.locator('#scene-panel')).toBeVisible();
  await page.locator('#view-menu > summary').click();
  await page.locator('#grid').check();
  await expect(page.locator('#snap')).not.toBeChecked();
  await page.locator('#objects-tab').click();
  await page.locator('.object-row').first().getByRole('button', { name: /Show/ }).click();
  await expect(page.locator('#save-state')).toHaveText('Unsaved');
  await page.locator('#viewport').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#selected-name')).toHaveText('Select an object');
  const box = await page.locator('#viewport').boundingBox();
  await page.mouse.move(box!.x + 5, box!.y + 5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 5, box!.y + box!.height - 5);
  await page.mouse.up();
  await expect(page.locator('#selected-name')).toContainText('2 objects selected');
});

test('visual authoring, independent fragments, pattern undo and import', async ({
  page,
  request,
}) => {
  const before = (await (await request.get('/__lantern_editor?fragments')).json()).fragments.map(
    (p: { id: string }) => p.id,
  ) as string[];
  try {
    await openEditor(page);
    await page.locator('#scene-tab').click();
    await page.locator('#ground-interaction-section > summary').click();
    await page.locator('[data-section=category-Geometry] > summary').click();
    await page.locator('[data-section=paths] > summary').click();
    await page
      .locator('#scene-panel')
      .getByRole('button', { name: 'Add Paths', exact: true })
      .click();
    await page.locator('[data-section="paths.0"] > summary').click();
    const width = page.locator('[data-field="paths.0.width"]');
    await width.fill('2');
    await width.dispatchEvent('change');
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.paths[0]?.width))
      .toBe(2);
    await page.getByRole('button', { name: 'Edit geometry on canvas', exact: true }).click();
    const pointBefore = await page.evaluate(
      () => window.sceneEditor.state().document.paths[0]!.points[0],
    );
    const screen = await page.evaluate(() => {
      const p = window.sceneEditor.state().document.paths[0]!.points[0]!,
        view = window.sceneEditor.view();
      return view.screen(view.presentation!.center.clone().set(p.x, 0, p.z));
    });
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    await page.mouse.move(screen.x + 30, screen.y + 10);
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.paths[0]!.points[0]))
      .not.toEqual(pointBefore);
    await page.locator('#undo').click();
    expect(
      await page.evaluate(() => window.sceneEditor.state().document.paths[0]!.points[0]),
    ).toEqual(pointBefore);
    await chooseGravestone(page);
    await page.locator('#viewport').click({ position: { x: 350, y: 230 } });
    await waitForEditorIdle(page);
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(1);
    const document = await page.evaluate(() => window.sceneEditor.state().document);
    const metadata = await (await request.get('/__lantern_editor')).json();
    const fragment = { version: 1, name: 'Pickup isolation regression', objects: document.objects };
    const unrelated = { ...document.objects[0]!, id: 'unselected-potion', x: 3, z: 3 };
    const savingFragment = await request.post('/__lantern_editor', {
      headers: { 'X-Lantern-Editor-Token': metadata.token },
      data: {
        action: 'fragment',
        baseRevision: metadata.baseRevision,
        fragment,
        document: {
          ...document,
          objects: [...document.objects, unrelated],
          gameplay: {
            ...document.gameplay,
            pickups: [
              {
                id: 'health',
                object: unrelated.id,
                kind: 'health',
                amount: 20,
                radius: 1,
                x: 3,
                z: 3,
              },
            ],
          },
        },
      },
    });
    expect(savingFragment.ok(), await savingFragment.text()).toBe(true);
    await page.locator('#artwork-tab').click();
    const initialFragments = page.waitForResponse('**/__lantern_editor?fragments');
    await page.locator('#arrangements').click();
    await initialFragments;
    await expect(page.locator('#library-fragments')).toContainText('Pickup isolation regression');
    await page.locator('#fragment-name').fill('Browser test arrangement');
    await waitForEditorIdle(page);
    const fragmentSaved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/__lantern_editor' &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON().action === 'fragment',
      { timeout: 60_000 },
    );
    const fragmentsRefreshed = page.waitForResponse('**/__lantern_editor?fragments', {
      timeout: 60_000,
    });
    await page.locator('#save-fragment').click();
    expect((await fragmentSaved).ok()).toBe(true);
    await fragmentsRefreshed;
    await expect(page.locator('#library-fragments')).toContainText('Browser test arrangement');
    await page
      .locator('#library-fragments')
      .getByRole('button', { name: 'Browser test arrangement · 1 objects', exact: true })
      .click();
    await waitForEditorIdle(page);
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(2);
    expect(
      await page.evaluate(
        () => new Set(window.sceneEditor.state().document.objects.map((p) => p.id)).size,
      ),
    ).toBe(2);
    await page.locator('#objects-tab').click();
    await page.locator('.object-select.active').first().click();
    await page.locator('#arrange-section > summary').click();
    await page.locator('#pattern-count').fill('2');
    await page.locator('#pattern-preview').click();
    await page.locator('#pattern-apply').click();
    await waitForEditorIdle(page);
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(4);
    await page.locator('#undo').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
      .toBe(2);
    const imported = await page.evaluate(() => window.sceneEditor.state().document);
    await page.locator('#import-scene').setInputFiles({
      name: 'scene.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await page.locator('#confirmation-accept').click();
    await waitForEditorIdle(page);
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
  test.setTimeout(180_000);
  await openEditor(page);
  await chooseGravestone(page);
  await page.locator('#viewport').click({ position: { x: 360, y: 310 } });
  await waitForEditorIdle(page);
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
    .toBe(1);
  await page.locator('#name').fill('Unsaved playtest');
  await page.locator('#viewport').focus();
  await expect(page.locator('#save-state')).toHaveText('Unsaved');
  const snapshot = () =>
    page.evaluate(() => ({
      document: window.sceneEditor.state().document,
      selected: window.sceneEditor.state().selected,
      camera: {
        center: window.sceneEditor.view().presentation!.center.toArray(),
        span: window.sceneEditor.view().presentation!.verticalSpan,
      },
      dock: document.querySelector('[role="tab"][aria-selected="true"]')!.id,
      storage: Object.fromEntries(Object.entries(localStorage)),
    }));
  const before = await snapshot();
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
        { timeout: 60000 },
      )
      .toBe('ready');
    await page.locator('#playtest-pause').click();
    await expect(page.locator('#playtest-pause')).toHaveText('Resume');
    await page.locator('#playtest-pause').click();
    await expect(page.locator('#playtest-viewport')).toBeFocused();
    await page.keyboard.down('KeyD');
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.playtest()?.hero.x))
      .not.toBe(before.document.hero.x);
    await page.keyboard.up('KeyD');
    await page.locator('#playtest-return').click();
    await expect(page.locator('#playtest-dialog')).not.toBeVisible();
    expect(await snapshot()).toEqual(before);
    expect(await page.evaluate(() => window.sceneEditor.playtest())).toBeUndefined();
  }
});

test('scene library tolerates malformed recent-scene metadata', async ({ page }) => {
  await openEditor(page);
  await page.route('**/__lantern_editor', (route) =>
    route.fulfill({
      json: {
        scenes: [
          { id: 'first', name: 'First fixture', target: 'draft' },
          { id: 'second', name: 'Second fixture', target: 'draft' },
        ],
      },
    }),
  );
  await page.evaluate(() => localStorage.setItem('lantern-editor-scenes', '{"unexpected":true}'));
  await page.locator('#document-menu > summary').click();
  await page.locator('#scene-library').click();
  await expect(page.locator('#scene-library-dialog')).toBeVisible();
  await expect(page.locator('#library-scenes')).toContainText('First fixture');
  await expect(page.locator('#library-scenes')).toContainText('Second fixture');
});

test('editor workspace keeps populated attachment controls accessible at desktop widths', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#import-scene').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sceneFixture('chapel'))),
  });
  await page.locator('#confirmation-accept').click();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.name))
    .toContain('Imported');
  await expect(page.locator('#save-state')).toHaveText('Unsaved');
  const child = await page.evaluate(
    () => window.sceneEditor.state().document.objects.find((p) => p.mount)?.id,
  );
  expect(child).toBeTruthy();
  await page.locator('#objects-tab').click();
  await page.getByRole('button', { name: child!, exact: true }).click();
  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#object-panel')).toBeVisible();
    const canvas = await page.locator('#viewport').boundingBox();
    expect(canvas!.width).toBeGreaterThan(250);
    expect(canvas!.height).toBeGreaterThan(300);
    await page.locator('#objects-tab').click();
    await expect(page.locator('#object-search')).toBeVisible();
    await page.locator('#objects-tab').click();
    await page.locator('.object-select.active').first().click();
  }
});

test('canvas-first workspace, focus, property search and commands preserve the draft', async ({
  page,
}) => {
  await openEditor(page);
  const before = await page.evaluate(() => window.sceneEditor.state().document);
  for (const [width, height, minimum] of [
    [1280, 720, 0.65],
    [1440, 900, 0.7],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect
      .poll(async () => {
        const canvas = await page.locator('#viewport').boundingBox();
        return (canvas!.width * canvas!.height) / (width! * height!);
      })
      .toBeGreaterThanOrEqual(minimum!);
  }
  await page.locator('#scene-tab').click();
  await page.locator('#commands').click();
  await page.locator('#command-search').fill('Camera');
  await page.locator('#command-search').fill('Camera › Bounds › Left (X)');
  await page.locator('#command-results').getByRole('button').click();
  await expect(page.locator('[data-field="camera.bounds.minX"]')).toBeFocused();
  await page.locator('#viewport').focus();
  await page.keyboard.press('Tab');
  const canvas = await page.locator('#viewport').boundingBox();
  expect((canvas!.width * canvas!.height) / (1440 * 900)).toBeGreaterThanOrEqual(0.9);
  await expect(page.locator('.dock')).not.toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#scene-panel')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('#command-search').fill('browse artwork');
  await page.locator('#command-results').getByRole('button', { name: 'Browse artwork' }).click();
  await expect(page.locator('#artwork-panel')).toBeVisible();
  await page.setViewportSize({ width: 800, height: 720 });
  await page.locator('#toggle-dock').click();
  await expect(page.locator('.dock')).not.toBeVisible();
  const narrow = await page.locator('#viewport').boundingBox();
  expect(narrow!.width).toBe(800);
  expect(narrow!.height).toBeGreaterThan(600);
  await page.reload();
  await waitForEditor(page);
  await expect(page.locator('.dock')).not.toBeVisible();
  await expect(page.locator('#toggle-dock')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before);
});

test('repeated placement, shared fields and canvas handles commit or cancel one gesture', async ({
  page,
}) => {
  await openEditor(page);
  await chooseGravestone(page);
  await page.locator('#repeat-placement').check();
  await page.locator('#viewport').click({ position: { x: 360, y: 310 } });
  await waitForEditorIdle(page);
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
    .toBe(1);
  await expect(page.locator('#artwork-panel')).toBeVisible();
  await expect(page.locator('#tool')).toHaveValue('place');
  await expect(page.locator('#tool')).toBeEnabled();
  await page.locator('#viewport').click({ position: { x: 460, y: 330 } });
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
    .toBe(2);
  await expect(page.locator('#tool')).toBeEnabled();
  await page.locator('#search').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tool')).toHaveValue('select');
  await page.locator('#objects-tab').click();
  await page.locator('.object-select').first().click();
  await page.locator('#objects-tab').click();
  await page
    .locator('.object-select')
    .last()
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('#selected-name')).toContainText('2 objects selected');
  await expect(page.locator('#x')).toHaveValue('');
  await page.locator('#scale').fill('1.5');
  await page.locator('#scale').dispatchEvent('change');
  await expect
    .poll(() =>
      page.evaluate(() => window.sceneEditor.state().document.objects.map((p) => p.scale)),
    )
    .toEqual([1.5, 1.5]);
  await page.locator('#undo').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.sceneEditor.state().document.objects.map((p) => p.scale)),
    )
    .toEqual([1, 1]);
  const before = await page.evaluate(() => window.sceneEditor.state().document);
  const matrices = () =>
    page.evaluate(() =>
      window.sceneEditor.view().presentation!.roomPresentation.inkRoom!.sprites.map((s) => ({
        id: s.id,
        position: s.mesh.position.toArray(),
        scale: s.mesh.scale.toArray(),
        quaternion: s.mesh.quaternion.toArray(),
      })),
    );
  const beforeMatrices = await matrices();
  const handle = page.locator('[data-handle=x]');
  await expect(handle).toBeVisible();
  await handle.hover();
  let box = await handle.boundingBox();
  await page.mouse.move(box!.x + 14, box!.y + 14);
  await page.mouse.down();
  // Move away from the hero spawn so the transform remains valid.
  await page.mouse.move(box!.x - 37, box!.y + 14);
  await expect.poll(matrices).not.toEqual(beforeMatrices);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before);
  expect(await matrices()).toEqual(beforeMatrices);
  await page.locator('#objects-tab').click();
  await page.locator('.object-select').first().click();
  await handle.hover();
  box = await handle.boundingBox();
  await page.mouse.move(box!.x + 14, box!.y + 14);
  await page.mouse.down();
  await page.mouse.move(box!.x - 37, box!.y + 14);
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document))
    .not.toEqual(before);
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before);
  const orientation = () =>
    page.evaluate(() => {
      const id = window.sceneEditor.state().selected;
      return window.sceneEditor
        .view()
        .presentation!.roomPresentation.inkRoom!.sprites.find((s) => s.id === id)!
        .mesh.quaternion.toArray();
    });
  const originalOrientation = await orientation();
  await page.locator('#rotation').fill('45');
  await page.locator('#rotation').dispatchEvent('change');
  await expect.poll(orientation).not.toEqual(originalOrientation);
  await page.locator('#undo').click();
  await expect.poll(orientation).toEqual(originalOrientation);
});

test('editor asset and ground filters preserve selections through edits and undo', async ({
  page,
}) => {
  await openEditor(page, '/editor.html');
  await page.locator('#artwork-tab').click();
  await page.locator('#search').fill('library-ct01');
  await expect(page.locator('#assets .asset')).toHaveCount(1);
  await page.locator('#art-filters > summary').click();
  await page.locator('#asset-scope').selectOption('used');
  await expect(page.locator('#assets .asset')).toHaveCount(0);
  await page.locator('#asset-scope').selectOption('all');
  await page.locator('#search').fill('library-pilgrim_chest');
  await expect(page.locator('#assets .asset')).toHaveCount(1);
  await page.locator('#assets .asset').click();
  await page.locator('#viewport').click({ position: { x: 300, y: 280 } });
  await expect(page.locator('#tool')).toBeEnabled({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
    .toBe(1);
  await page.locator('#artwork-tab').click();
  await page.locator('#asset-scope').selectOption('scene');
  await expect(page.locator('#assets .asset')).toHaveCount(1);
  await page.locator('#undo').click();
  await expect(page.locator('#assets .asset')).toHaveCount(0);
  await page.locator('#asset-scope').selectOption('all');
  await page.locator('#asset-animated').check();
  await page.locator('#search').fill('ink-stage-earth');
  await expect(page.locator('#assets .asset')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear animated filter' }).click();
  await expect(page.locator('#assets .asset')).toHaveCount(1);
  const initial = await page.evaluate(() => window.sceneEditor.state().document.floor);
  await page.locator('#scene-tab').click();
  await page.locator('#ground-section > summary').click();
  await page.locator('#ground-browser > summary').click();
  await page.getByText('Filters & asset details', { exact: true }).click();
  const all = await page
    .locator('#floor option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const dimensions = await page.evaluate(async (values) => {
    const runtime = window.sceneEditor.view().runtime;
    return Object.fromEntries(
      await Promise.all(
        values.map(async (value) => {
          const manifest = await runtime.manifest(value.split('/')[0]!);
          return [value, manifest.asset.canvas];
        }),
      ),
    );
  }, all);
  await page.locator('#ground-high-res').check();
  const filtered = await page
    .locator('#floor option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(filtered).toEqual(all.filter((value) => Math.max(...dimensions[value]) >= 3840));
  await page.locator('#ground-search').fill('no-such-ground-xyz');
  await expect(page.locator('#floor option')).toHaveCount(0);
  await expect(page.locator('#ground-results')).toContainText('No matching ground');
  expect(await page.evaluate(() => window.sceneEditor.state().document.floor)).toEqual(initial);
  // Dimension edits must retain the current ground even while filters hide it.
  await page.locator('#width').fill('24');
  await page.locator('#width').press('Tab');
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.floor.width))
    .toBe(24);
  expect(await page.evaluate(() => window.sceneEditor.state().document.floor.asset)).toBe(
    initial.asset,
  );
  const choice = filtered[0] ?? all[0]!;
  if (!filtered.length) await page.locator('#ground-high-res').uncheck();
  await page.locator('#ground-search').fill(choice.split('/')[0]!);
  await expect(page.locator('#ground-search')).toHaveValue(choice.split('/')[0]!);
  await page.locator(`[data-ground="${choice}"]`).click();
  await waitForEditorIdle(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.sceneEditor.state().document.floor.asset +
          '/' +
          window.sceneEditor.state().document.floor.clip,
      ),
    )
    .toBe(choice);
  await page.locator('#undo').click();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.floor.asset))
    .toBe(initial.asset);
});

test('complete scenes retain native masters and place as one image with source coverage visible', async ({
  page,
  request,
}) => {
  const flags = await (await request.get('/build-mode.json')).json();
  test.skip(
    !flags.libraryInventory,
    'The existing published pin predates complete-library delivery.',
  );
  const index = await (await request.get('/generated/library/index.json')).json();
  const masters = Object.values(index).filter(
    (m: any) =>
      m.asset.imageRole === 'scene-painting' &&
      m.asset.canvas[0] === 6144 &&
      m.asset.canvas[1] === 4096,
  ) as any[];
  expect(masters.length).toBeGreaterThan(0);
  for (const manifest of masters) {
    expect(manifest.pages[0].width).toBe(6144);
    expect(manifest.pages[0].height).toBe(4096);
    expect(
      manifest.pages[0].delivery.some(
        (v: any) => v.encoding === 'png' && v.width === 6144 && v.height === 4096,
      ),
    ).toBe(true);
  }
  const master = masters[0];
  // Exercise device-fit delivery even on the larger software GPU used by CI.
  await page.addInitScript(() => {
    const getParameter = Object.getOwnPropertyDescriptor(
      WebGL2RenderingContext.prototype,
      'getParameter',
    )!.value;
    WebGL2RenderingContext.prototype.getParameter = function (parameter) {
      return parameter === this.MAX_TEXTURE_SIZE ? 4096 : getParameter.call(this, parameter);
    };
  });
  await openEditor(page, '/editor.html');
  await page.locator('#document-menu > summary').click();
  await page.locator('#developer-menu > summary').click();
  await page.locator('#source-library > summary').click();
  const inventory = await (await request.get('/generated/library/inventory.json')).json();
  await expect(page.locator('#library-inventory')).toContainText(
    inventory.images.length.toLocaleString() + ' distinct images',
  );
  await page.locator('#document-menu > summary').click();
  await page.locator('#scene-tab').click();
  await page.locator('#ground-section > summary').click();
  await page.locator('#ground-browser > summary').click();
  await page.locator('#ground-search').fill(master.asset.id);
  await page.locator(`[data-ground="${master.asset.id}/still"]`).click();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.floor.layout), {
      timeout: 30_000,
    })
    .toBe('artwork');
  const floor = await page.evaluate(() => window.sceneEditor.state().document.floor);
  expect(floor.width / floor.depth).toBeCloseTo(1.5, 8);
  const textures = await page.evaluate((id) => {
    const pack = window.sceneEditor.view().presentation!.packs.get(id)!;
    return [...pack.textures.values()].map((texture) => {
      const image = texture.image as { width: number; height: number };
      return {
        width: image.width,
        height: image.height,
        compressed: 'isCompressedTexture' in texture && texture.isCompressedTexture === true,
      };
    });
  }, master.asset.id);
  expect(textures.length).toBeGreaterThan(0);
  for (const texture of textures) {
    expect(Math.max(texture.width, texture.height)).toBeLessThanOrEqual(4096);
    expect(texture.compressed).toBe(false);
  }
  await page.locator('#depth').fill('8');
  await page.locator('#depth').dispatchEvent('change');
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.floor.width))
    .toBe(12);
  await page.locator('#play-from-here').click();
  await page.waitForFunction(() => window.sceneEditor.playtest()?.ready);
  await page.locator('#playtest-return').click();
});

test('editor walking preserves state, releases input and constrains the camera at ground edges', async ({
  page,
}) => {
  await openEditor(page, '/editor.html');
  const initial = await page.evaluate(() => ({
    state: window.sceneEditor.state(),
    center: window.sceneEditor.view().presentation!.center.toArray(),
    storage: Object.fromEntries(Object.entries(localStorage)),
  }));
  await page.locator('#scene-tab').click();
  await page.locator('[data-section="category-Atmosphere"] > summary').click();
  await page.locator('[data-section="weather"] > summary').click();
  await page.locator('[data-field="weather.rain"]').dispatchEvent('change');
  expect(await page.evaluate(() => window.sceneEditor.state())).toEqual(initial.state);
  await page.locator('#sun-azimuth').dispatchEvent('change');
  expect(await page.evaluate(() => window.sceneEditor.state())).toEqual(initial.state);
  // Dock navigation has its own disposable preference; movement must not write storage.
  initial.storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  await expect(page.locator('#walk-hero')).toHaveCount(0);
  await page.locator('#viewport').focus();
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.sceneEditor.view().sim!.hero.state === 'walk');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const hero = window.sceneEditor.view().sim!.hero;
        const spawn = window.sceneEditor.state().document.hero;
        return Math.hypot(hero.x - spawn.x, hero.z - spawn.z);
      }),
    )
    .toBeGreaterThan(0.2);
  await page.keyboard.up('w');
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.view().sim!.hero.state))
    .toBe('idle');
  await page.keyboard.down('d');
  await page.waitForFunction(() => window.sceneEditor.view().sim!.hero.state === 'walk');
  await page.locator('#name').focus();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.view().sim!.hero.state))
    .toBe('idle');
  await page.keyboard.up('d');
  const paused = await page.evaluate(() => ({
    x: window.sceneEditor.view().sim!.hero.x,
    z: window.sceneEditor.view().sim!.hero.z,
  }));
  await page.locator('#name').fill('wasd');
  await page.keyboard.press('w');
  expect(
    await page.evaluate(() => ({
      x: window.sceneEditor.view().sim!.hero.x,
      z: window.sceneEditor.view().sim!.hero.z,
    })),
  ).toEqual(paused);
  expect(await page.evaluate(() => window.sceneEditor.state())).toEqual(initial.state);
  expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(
    initial.storage,
  );
  // An idle walking preview must not recenter the camera during editing.
  const panned = await page.evaluate(() => {
    const view = window.sceneEditor.view();
    view.presentation!.center.x += 1;
    view.render();
    return view.presentation!.center.toArray();
  });
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.view().presentation!.center.toArray()))
    .toEqual(panned);
  await page.locator('#viewport').focus();
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => {
      const view = window.sceneEditor.view();
      return {
        x: view.sim!.hero.x,
        z: view.sim!.hero.z,
        center: view.presentation!.center.toArray(),
        tick: view.sim!.tick,
      };
    }),
  ).toEqual({ ...initial.state.document.hero, center: initial.center, tick: 0 });
  const zoom = await page.evaluate(() => {
    const view = window.sceneEditor.view();
    view.presentation!.verticalSpan = 20;
    document
      .getElementById('viewport')!
      .dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    return view.presentation!.verticalSpan;
  });
  expect(zoom).toBeCloseTo(20 * Math.exp(-0.3), 6);
  await page.locator('#viewport').dispatchEvent('wheel', { deltaY: 100 });
  expect(
    await page.evaluate(() => window.sceneEditor.view().presentation!.verticalSpan),
  ).toBeCloseTo(20, 6);
  await page.locator('#view-menu > summary').click();
  await page.getByRole('button', { name: 'Reset game zoom', exact: true }).click();
  expect(
    await page.evaluate(async () => {
      const contractPath = '/src/assets/camera-contract.ts';
      const { cameraContract: contract } = await import(contractPath);
      return window.sceneEditor.view().presentation!.verticalSpan === contract.verticalSpan;
    }),
  ).toBe(true);
  await page.locator('#view-menu > summary').click();
  const result = await page.evaluate(() => {
    const view = window.sceneEditor.view(),
      presentation = view.presentation!,
      area = view.sim!.areaDefinition,
      initial = { x: view.sim!.hero.x, z: view.sim!.hero.z },
      center = presentation.center.toArray();
    view.setHeroWalking(true);
    // Exercise a long walk in each screen direction without wall-clock waits.
    const samples = [];
    for (const [x, y] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      view.walkHero(x!, y!, 100_000);
      view.render();
      const hero = view.sim!.hero,
        camera = presentation.camera,
        direction = camera.getWorldDirection(camera.position.clone());
      const corners = [-1, 1].flatMap((u) =>
        [-1, 1].map((v) => {
          const p = camera.position.clone().set(u, v, 0).unproject(camera);
          p.addScaledVector(direction, (-0.01 - p.y) / direction.y);
          return { x: p.x, z: p.z };
        }),
      );
      samples.push({ hero: { x: hero.x, z: hero.z }, corners });
    }
    view.setHeroWalking(false);
    return {
      samples,
      bounds: area.bounds,
      radius: view.sim!.hero.definition.radius,
      initial,
      restored: { x: view.sim!.hero.x, z: view.sim!.hero.z },
      center,
      restoredCenter: presentation.center.toArray(),
    };
  });
  const { bounds: b, radius } = result;
  for (const { hero, corners } of result.samples) {
    expect(hero.x).toBeGreaterThanOrEqual(b.minX + radius - 1e-8);
    expect(hero.x).toBeLessThanOrEqual(b.maxX - radius + 1e-8);
    expect(hero.z).toBeGreaterThanOrEqual(b.minZ + radius - 1e-8);
    expect(hero.z).toBeLessThanOrEqual(b.maxZ - radius + 1e-8);
    expect(
      Math.min(hero.x - b.minX, b.maxX - hero.x, hero.z - b.minZ, b.maxZ - hero.z),
    ).toBeCloseTo(Math.max(0.3, radius));
    for (const p of corners) {
      expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-7);
      expect(p.x).toBeLessThanOrEqual(b.maxX + 1e-7);
      expect(p.z).toBeGreaterThanOrEqual(b.minZ - 1e-7);
      expect(p.z).toBeLessThanOrEqual(b.maxZ + 1e-7);
    }
  }
  expect(result.restored).toEqual(result.initial);
  expect(result.restoredCenter).toEqual(result.center);
  await page.locator('[data-field="weather.rain"]').fill('0.2');
  await page.locator('[data-field="weather.rain"]').dispatchEvent('change');
  await expect(page.locator('#tool')).toBeEnabled({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.weather?.rain))
    .toBe(0.2);
  await page.locator('#undo').click();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.weather))
    .toBeUndefined();
  await page.locator('#sun-azimuth').fill('90');
  await page.locator('#sun-azimuth').dispatchEvent('change');
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.look.sun?.azimuthDeg))
    .toBe(90);
  await page.locator('#sun-elevation').fill('35');
  await page.locator('#sun-elevation').dispatchEvent('change');
  await expect
    .poll(() =>
      page.evaluate(() => window.sceneEditor.view().presentation!.lookRenderer.settings.sun),
    )
    .toEqual({ azimuthDeg: 90, elevationDeg: 35 });
  await page.locator('#sun-preset').click();
  await expect
    .poll(() =>
      page.evaluate(() => window.sceneEditor.view().presentation!.lookRenderer.settings.sun),
    )
    .toBeUndefined();
  await page.locator('#undo').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.sceneEditor.view().presentation!.lookRenderer.settings.sun?.elevationDeg,
      ),
    )
    .toBe(35);
});

test('task destinations preserve advanced data and show suitable grounds before experimental artwork', async ({
  page,
  request,
}) => {
  await openEditor(page);
  await expect(page.getByRole('tab')).toHaveText(['Add', 'Objects', 'Scene']);
  await page.locator('#focus-mode').click();
  await expect(page.locator('#focus-mode')).toBeVisible();
  await expect(page.locator('#focus-mode')).toHaveText('Exit focus');
  await page.locator('#focus-mode').click();
  await expect(page.locator('#scene-panel')).toBeVisible();
  await page.locator('#ground-interaction-section > summary').click();
  await expect(page.locator('#ground-painting-tools')).not.toBeVisible();
  await expect(page.locator('#ground-layout-help')).toBeVisible();
  await expect(page.locator('#ground-geometry > summary')).toBeVisible();
  await chooseGravestone(page);
  await page.locator('#viewport').click({ position: { x: 350, y: 300 } });
  await waitForEditorIdle(page);
  await expect(page.locator('#object-panel')).toBeVisible();
  await expect(page.locator('#objects-tab')).toHaveAttribute('aria-selected', 'true');
  const capture = async (name: string) => {
    const directory = process.env.LANTERN_EDITOR_REVIEW_DIR;
    if (directory) {
      await fs.mkdir(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, name + '.png') });
    }
  };
  await capture('object-properties');
  await page.locator('#back-to-objects').click();
  await expect(page.locator('#objects-panel')).toBeVisible();
  await page.locator('.object-select').first().click();
  await expect(page.locator('#object-panel')).toBeVisible();
  await page.locator('#scene-tab').click();
  await page.locator('[data-section=category-Gameplay] > summary').click();
  await page.locator('[data-section="gameplay.spawns"] > summary').click();
  await page.getByRole('button', { name: 'Add Enemies', exact: true }).click();
  await page.locator('[data-section="gameplay.spawns.0"] > summary').click();
  await expect(page.locator('[data-field="gameplay.spawns.0.actor"]')).toBeVisible();
  await expect(page.locator('[data-field="gameplay.spawns.0.awareness.radius"]')).not.toBeVisible();
  await page.locator('[data-section="gameplay.spawns.0.advanced"] > summary').click();
  await page.locator('[data-section="gameplay.spawns.0.awareness"] > summary').click();
  await page.locator('[data-field="gameplay.spawns.0.awareness.radius"]').fill('4.25');
  await page.locator('[data-field="gameplay.spawns.0.awareness.radius"]').press('Tab');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.sceneEditor.state().document.gameplay!.spawns[0]!.awareness!.radius,
      ),
    )
    .toBe(4.25);
  const before = await page.evaluate(() => window.sceneEditor.state().document);
  await page.locator('#ground-section > summary').click();
  await page.locator('#ground-browser > summary').click();
  const values = await page
    .locator('#floor option')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value));
  for (const value of values) {
    const manifest = await page.evaluate(
      async (id) => window.sceneEditor.view().runtime.manifest(id),
      value.split('/')[0]!,
    );
    expect(manifest.asset.imageRole).toBe('scene-painting');
  }
  if (values.length)
    await expect
      .poll(
        () =>
          page
            .locator('#ground-thumbnails canvas')
            .first()
            .evaluate(
              (node: HTMLCanvasElement) =>
                node.getContext('2d')!.getImageData(node.width / 2, node.height / 2, 1, 1).data[3],
            ),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  await capture('ground-browser');
  await page.locator('#ground-kind').selectOption('all');
  expect(await page.locator('#floor option').count()).toBeGreaterThan(values.length);
  await page.locator('#ground-search').fill('no-ground-matches-this');
  await expect(page.locator('#ground-current')).not.toBeEmpty();
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before);
  await page.locator('#document-menu > summary').click();
  await page.locator('#recovery-history').click();
  await expect(page.locator('[data-library=scenes]')).not.toBeVisible();
  await expect(page.locator('[data-library=arrangements]')).not.toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#artwork-tab').click();
  await page.locator('#arrangements').click();
  await expect(page.locator('[data-library=arrangements]')).toBeVisible();
  await expect(page.locator('[data-library=recovery]')).not.toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before);
  const flags = await (await request.get('/build-mode.json')).json();
  if (flags.libraryInventory && values.length) {
    await page.locator('#scene-tab').click();
    await page.locator('#ground-kind').selectOption('scene-painting');
    await page.locator('#ground-search').fill(values[0]!.split('/')[0]!);
    await page.locator(`[data-ground="${values[0]}"]`).click();
    await waitForEditorIdle(page);
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.floor.layout))
      .toBe('artwork');
    await page.locator('#ground-interaction-section > summary').click();
    await expect(page.locator('#ground-brush-radius')).not.toBeVisible();
    await expect(page.locator('#ground-accept')).not.toBeVisible();
    await expect(page.locator('#ground-finish')).not.toBeVisible();
    await page.locator('#ground-interaction-section > summary').scrollIntoViewIfNeeded();
    await capture('painted-scene');
    const painted = await page.evaluate(() => window.sceneEditor.state().document);
    await page.locator('#start-tool').click();
    await expect(page.locator('#ground-interaction-section')).not.toHaveAttribute('open');
    await expect(page.locator('#tool')).toHaveValue('hero');
    await page.locator('#select-tool').click();
    await page.locator('#commands').click();
    await page.locator('#command-search').fill('Brush radius');
    await page.locator('#command-results').getByRole('button').click();
    await expect(page.locator('#ground-brush-radius')).toBeFocused();
    await page.locator('#select-tool').click();
    expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(painted);
    await page.setViewportSize({ width: 600, height: 720 });
    await page.locator('#scene-tab').click();
    await expect(page.locator('#status')).toBeEmpty();
    await capture('narrow-workspace');
  }
});
