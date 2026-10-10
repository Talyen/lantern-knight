import { test, expect } from './fixtures';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../tools/assets/paths';
import type {} from '../../src/editor/main';
import { sceneFixture } from '../fixtures/scene';
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
    await page.locator('#artwork-tab').click();
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
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.locator('#artwork-tab').click();
  await page.locator('#search').fill('ink-scenery');
  await page.getByTitle('ink-scenery/arch', { exact: true }).click();
  await expect(page.locator('#assets .asset')).toHaveCount(1);
  await page.locator('#place-clip').selectOption('gravestone');
  await page.locator('#viewport').click({ position: { x: 300, y: 250 } });
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
    await page.goto('/editor.html?automated');
    await page.waitForFunction(() => window.sceneEditor?.ready());
    await page.locator('#scene-tab').click();
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
    await page.locator('#tool').selectOption('geometry');
    await page.locator('#artwork-tab').click();
    await page.locator('#search').fill('ink-scenery');
    await page.getByTitle('ink-scenery/arch', { exact: true }).click();
    await page.locator('#place-clip').selectOption('gravestone');
    await page.locator('#viewport').click({ position: { x: 350, y: 230 } });
    await page.locator('#document-menu > summary').click();
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
    await page.locator('#object-tab').click();
    await page.locator('#arrange-section > summary').click();
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
  test.setTimeout(180_000);
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.locator('#artwork-tab').click();
  await page.locator('#search').fill('ink-scenery');
  await page.getByTitle('ink-scenery/arch', { exact: true }).click();
  await page.locator('#place-clip').selectOption('gravestone');
  await page.locator('#viewport').click({ position: { x: 360, y: 310 } });
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
    .toBe(1);
  await page.locator('#name').fill('Unsaved playtest');
  await page.locator('#viewport').focus();
  await expect(page.locator('#save-state')).toHaveText('Unsaved');
  const before = await page.evaluate(() => ({
    document: window.sceneEditor.state().document,
    selected: window.sceneEditor.state().selected,
    camera: {
      center: window.sceneEditor.view().presentation!.center.toArray(),
      span: window.sceneEditor.view().presentation!.verticalSpan,
    },
    dock: document.querySelector('[role="tab"][aria-selected="true"]')!.id,
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
        { timeout: 60000 },
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
    expect(await page.evaluate(() => window.sceneEditor.state().selected)).toBe(before.selected);
    expect(
      await page.evaluate(() => ({
        center: window.sceneEditor.view().presentation!.center.toArray(),
        span: window.sceneEditor.view().presentation!.verticalSpan,
      })),
    ).toEqual(before.camera);
    expect(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('id')).toBe(
      before.dock,
    );
    expect(await page.evaluate(() => window.sceneEditor.playtest())).toBeUndefined();
  }
});

test('editor workspace keeps populated attachment controls accessible at desktop widths', async ({
  page,
}) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  page.on('dialog', (dialog) => void dialog.accept());
  await page.locator('#import-scene').setInputFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sceneFixture('chapel'))),
  });
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
    const frame = await page.evaluate(
      () => window.sceneEditor.view().presentation!.renderer.info.render.frame,
    );
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => window.sceneEditor.view().presentation!.renderer.info.render.frame),
      )
      .toBeGreaterThan(frame + 2);
    await expect(page.locator('#object-panel')).toBeVisible();
    const canvas = await page.locator('#viewport').boundingBox();
    expect(canvas!.width).toBeGreaterThan(250);
    expect(canvas!.height).toBeGreaterThan(300);
    await page.locator('#objects-tab').click();
    await expect(page.locator('#object-search')).toBeVisible();
    await page.locator('#object-tab').click();
  }
});

test('geometry handles edit a path point with one undoable gesture', async ({ page }) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.locator('#scene-tab').click();
  await page.locator('[data-section=category-Geometry] > summary').click();
  await page.locator('[data-section=paths] > summary').click();
  await page
    .locator('#scene-panel')
    .getByRole('button', { name: 'Add Paths', exact: true })
    .click();
  await page.locator('#tool').selectOption('geometry');
  const before = await page.evaluate(() => window.sceneEditor.state().document.paths[0]!.points[0]);
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
    .not.toEqual(before);
  await page.locator('#undo').click();
  expect(
    await page.evaluate(() => window.sceneEditor.state().document.paths[0]!.points[0]),
  ).toEqual(before);
});

test('canvas-first workspace, focus, property search and commands preserve the draft', async ({
  page,
}, testInfo) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  const before = await page.evaluate(() => window.sceneEditor.state().document);
  for (const [width, height, minimum] of [
    [1280, 720, 0.65],
    [1440, 900, 0.7],
  ]) {
    const frame = await page.evaluate(
      () => window.sceneEditor.view().presentation!.renderer.info.render.frame,
    );
    await page.setViewportSize({ width: width!, height: height! });
    await expect
      .poll(() =>
        page.evaluate(() => window.sceneEditor.view().presentation!.renderer.info.render.frame),
      )
      .toBeGreaterThan(frame + 2);
    const canvas = await page.locator('#viewport').boundingBox();
    expect((canvas!.width * canvas!.height) / (width! * height!)).toBeGreaterThanOrEqual(minimum!);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${width}.png`) });
  }
  await page.locator('#scene-tab').click();
  await page.locator('#property-search').fill('Left (X)');
  await page.locator('#property-results').getByRole('button').click();
  await expect(page.locator('[data-field="camera.bounds.minX"]')).toBeFocused();
  await page.locator('#viewport').focus();
  await page.keyboard.press('Tab');
  const canvas = await page.locator('#viewport').boundingBox();
  expect((canvas!.width * canvas!.height) / (1440 * 900)).toBeGreaterThanOrEqual(0.9);
  await expect(page.locator('.dock')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('workspace-focus.png') });
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
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await expect(page.locator('.dock')).not.toBeVisible();
  await expect(page.locator('#toggle-dock')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before);
});

test('repeated placement, shared fields and canvas handles commit or cancel one gesture', async ({
  page,
}, testInfo) => {
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  await page.locator('#artwork-tab').click();
  await page.locator('#search').fill('ink-scenery');
  await page.getByTitle('ink-scenery/arch', { exact: true }).click();
  await page.locator('#place-clip').selectOption('gravestone');
  await page.locator('#repeat-placement').check();
  await page.locator('#viewport').click({ position: { x: 360, y: 310 } });
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
    .toBe(1);
  await expect(page.locator('#artwork-panel')).toBeVisible();
  await expect(page.locator('#tool')).toHaveValue('place');
  await page.locator('#viewport').click({ position: { x: 460, y: 330 } });
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.objects.length))
    .toBe(2);
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
  let box = await handle.boundingBox();
  await page.mouse.move(box!.x + 14, box!.y + 14);
  await page.mouse.down();
  await page.mouse.move(box!.x + 65, box!.y + 14);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before);
  expect(await matrices()).toEqual(beforeMatrices);
  await page.locator('#objects-tab').click();
  await page.locator('.object-select').first().click();
  box = await handle.boundingBox();
  await page.mouse.move(box!.x + 14, box!.y + 14);
  await page.mouse.down();
  await page.mouse.move(box!.x + 65, box!.y + 14);
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document))
    .not.toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('workspace-selection.png') });
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

test('shared editor asset filters update for unsaved placement and undo', async ({ page }) => {
  await page.goto('/editor.html');
  await page.waitForFunction(() => window.sceneEditor?.ready());
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
});
