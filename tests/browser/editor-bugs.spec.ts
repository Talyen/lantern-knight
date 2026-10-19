import {
  changeField,
  importEditorScene,
  readEditorDocument,
  expectEditorDocument,
} from './editor-driver';
import { test, expect, openEditor } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../tools/assets/paths';
import { emptyScene } from '../../src/editor/default-scene';

function scene(name: string) {
  const document = emptyScene();
  document.name = name;
  document.objects = ['support', 'reward'].map((id, i) => ({
    id,
    kind: 'prop',
    asset: 'ink-scenery',
    clip: i ? 'lantern' : 'gravestone',
    x: i ? -2 : 2,
    z: 0,
  }));
  document.paths = [
    {
      points: [
        { x: -1, z: 2 },
        { x: 1, z: 2 },
      ],
      width: 1,
    },
  ];
  document.gameplay!.pickups = [
    { id: 'health', object: 'reward', kind: 'health', amount: 25, radius: 0.5, x: -2, z: 0 },
  ];
  return document;
}

async function importScene(page: Page, name: string) {
  await importEditorScene(page, scene(name), 'scene.json');
  await expectEditorDocument(page, (document) => document.name).toBe('Imported ' + name);
  await expect(page.locator('#save-state')).not.toHaveText('Working…');
}

test('editor scopes visibility and locks to the opened scene, respects shortcuts and cancels numeric scrubs', async ({
  page,
  request,
}) => {
  await openEditor(page);
  await importScene(page, 'First');
  const source = await readEditorDocument(page);
  const metadata = await (await request.get('/__lantern_editor')).json();
  let fragmentId: string | undefined;
  try {
    const result = await request.post('/__lantern_editor', {
      headers: { 'X-Lantern-Editor-Token': metadata.token },
      data: {
        action: 'fragment',
        baseRevision: metadata.baseRevision,
        document: {
          ...source,
          gameplay: {
            ...source.gameplay,
            interactables: [
              {
                id: 'container',
                object: 'reward',
                kind: 'container',
                x: -2,
                z: 0,
                rewards: [{ item: 'gold', amount: 3 }],
                idle: 'gravestone',
                action: 'gravestone',
                spent: 'gravestone',
              },
            ],
          },
        },
        fragment: {
          version: 1,
          name: 'Partial selection with unrelated reward',
          objects: [source.objects[0]],
        },
      },
    });
    expect(result.ok(), await result.text()).toBe(true);
    fragmentId = (await result.json()).id;
    await page.locator('#objects-tab').click();
    await page.getByRole('button', { name: 'Lock support', exact: true }).click();
    await page.getByRole('button', { name: 'Hide support', exact: true }).click();
    await expect(page.locator('#save-state')).not.toHaveText('Working…');
    await importScene(page, 'Second');
    expect(
      await page.evaluate(() =>
        window.sceneEditor
          .view()
          .presentation!.roomPresentation.inkRoom!.sprites.some(
            (s) => s.id === 'support' && s.mesh.visible,
          ),
      ),
    ).toBe(true);
    await page.locator('#objects-tab').click();
    await page
      .locator('.object-select')
      .filter({ hasText: /^support$/ })
      .click();
    await expect(page.locator('#transform')).toBeEnabled();
    const before = await page.evaluate(() =>
      window.sceneEditor.view().presentation!.center.toArray(),
    );
    await page
      .locator('#viewport')
      .dispatchEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(
      await page.evaluate(() => window.sceneEditor.view().presentation!.center.toArray()),
    ).toEqual(before);

    const input = page.locator('#x'),
      label = input.locator('..');
    const original = await input.inputValue(),
      box = (await label.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 84, box.y + 4);
    await expect(input).not.toHaveValue(original);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(input).toHaveValue(original);
    await page.mouse.up();
    expect(await readEditorDocument(page, (document) => document.objects[0]!.x)).toBe(2);
    await page.screenshot({ path: path.join(projectRoot, '.cache/bug-fixes-editor.png') });
  } finally {
    if (fragmentId)
      await fs.rm(path.join(projectRoot, 'authoring/fragments', fragmentId + '.json'), {
        force: true,
      });
  }
});

test('foreign pointer releases and lost captures cannot commit geometry or leave a marquee active', async ({
  page,
}) => {
  await openEditor(page);
  await importScene(page, 'Pointers');
  await page.locator('#scene-tab').click();
  await page.locator('#ground-interaction-section > summary').click();
  await page.locator('#ground-geometry > summary').click();
  await page.getByRole('button', { name: 'Edit geometry on canvas', exact: true }).click();
  const start = await page.evaluate(() => {
    const view = window.sceneEditor.view(),
      p = window.sceneEditor.state().document.paths[0]!.points[0]!;
    return view.screen(view.presentation!.center.clone().set(p.x, 0, p.z));
  });
  const canvas = page.locator('#viewport');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await canvas.dispatchEvent('pointerup', {
    pointerId: 42,
    clientX: start.x + 40,
    clientY: start.y + 20,
  });
  await page.mouse.up();
  await expect(page.locator('#save-state')).not.toHaveText('Working…');
  const point = await readEditorDocument(page, (document) => document.paths[0]!.points[0]!);
  expect(point.x).toBeCloseTo(-1, 6);
  expect(point.z).toBeCloseTo(2, 6);
  await page.locator('#select-tool').click();
  await canvas.click({ position: { x: 30, y: 30 } });
  await page.mouse.down();
  await page.mouse.move(start.x, start.y);
  await canvas.dispatchEvent('lostpointercapture', { pointerId: 1 });
  await expect(page.locator('#marquee')).toBeHidden();
  await page.mouse.up();
});

test('document operations revoke geometry drags before pointer release', async ({
  page,
  errors,
}) => {
  await openEditor(page);
  await importScene(page, 'Gesture ownership');
  const original = await readEditorDocument(page);
  await changeField(page.locator('#name'), 'Undo this name');
  await expect(page.locator('#save-state')).not.toHaveText('Working…');
  await page.locator('#scene-tab').click();
  await page.locator('#ground-interaction-section > summary').click();
  await page.locator('#ground-geometry > summary').click();
  await page.getByRole('button', { name: 'Edit geometry on canvas', exact: true }).click();
  const start = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js';
    const { Vector3 } = await import(threePath);
    const view = window.sceneEditor.view();
    const point = window.sceneEditor.state().document.paths[0]!.points[0]!;
    return view.screen(new Vector3(point.x, 0, point.z));
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect
    .poll(() => page.locator('#viewport').evaluate((canvas) => canvas.hasPointerCapture(1)))
    .toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await expectEditorDocument(page, (document) => document.name).toBe(original.name);
  await expect(page.locator('#save-state')).not.toHaveText('Working…');
  await expect.soft
    .poll(() => page.locator('#viewport').evaluate((canvas) => canvas.hasPointerCapture(1)))
    .toBe(false);
  await page.mouse.move(start.x + 40, start.y + 20);
  await page.mouse.up();
  await expect(page.locator('#save-state')).not.toHaveText('Working…');
  expect(await readEditorDocument(page)).toEqual(original);
  await expect(page.locator('#redo')).toBeEnabled();
  // The revoked gesture must not prevent the next intentional drag from committing.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 20);
  await page.mouse.up();
  await expectEditorDocument(page, (document) => document.paths[0]!.points[0]).not.toEqual(
    original.paths[0]!.points[0],
  );
  await page.keyboard.press('ControlOrMeta+z');
  await expectEditorDocument(page, (document) => document).toEqual(original);
  expect(errors).toEqual([]);
});
