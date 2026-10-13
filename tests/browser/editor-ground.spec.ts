import { readJson } from '../../tools/json-file';
import { test, expect, openEditor, waitForEditor } from './fixtures';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../tools/assets/paths';
import { emptyScene } from '../../src/editor/default-scene';
import type {} from '../../src/editor/main';

test('ground authoring accepts and corrects selection, saves contours and routes multiple actors without storage writes', async ({
  page,
  request,
}) => {
  test.setTimeout(600_000);
  const id = 'ground-proof-' + Date.now(),
    file = path.join(projectRoot, 'authoring/scenes', id + '.json');
  const mask = [
    {
      outer: [
        [0.53, 0.3],
        [0.65, 0.3],
        [0.65, 0.6],
        [0.53, 0.6],
      ],
      holes: [],
    },
  ];
  let selections = 0;
  let profileId: string | undefined;
  await page.route('**/__lantern_editor', async (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().action === 'segment'
    ) {
      selections++;
      await route.fulfill({
        json: {
          mask,
          ...(route.request().postDataJSON().selection.operation === 'detect'
            ? {
                candidates: [{ name: 'pine tree', score: 0.91, box: [0.53, 0.3, 0.65, 0.6] }],
              }
            : {}),
          device: 'deterministic fixture',
          milliseconds: 12,
        },
      });
    } else await route.continue();
  });
  try {
    page.on('dialog', (dialog) => void dialog.accept());
    await page.addInitScript(() =>
      localStorage.setItem(
        'lantern-ground-overlays',
        JSON.stringify({ blockers: true, masks: true, depth: true }),
      ),
    );
    await openEditor(page);
    for (const key of ['blockers', 'masks', 'depth'])
      await expect(page.locator('#ground-show-' + key)).not.toBeChecked();
    const d = emptyScene();
    d.name = id;
    d.floor.layout = 'artwork';
    // The sandbox supplies three reachable enemies without changing the saved scene.
    d.gameplay!.spawns = [];
    await page.locator('#import-scene').setInputFiles({
      name: 'fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(d)),
    });
    await page.locator('#confirmation-accept').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.floor.layout), {
        timeout: 30_000,
      })
      .toBe('artwork');
    await page.locator('#scene-tab').click();
    await page.locator('#ground-interaction-section > summary').click();
    const clickUV = async (u: number, v: number) => {
      const p = await page.evaluate(
        async ([u, v]) => {
          const floorPath = '/src/content/floor-layout.ts',
            threePath = '/node_modules/.vite/deps/three.js';
          const { artworkFloorLayout } = await import(floorPath),
            T = await import(threePath),
            d = window.sceneEditor.state().document,
            world = artworkFloorLayout(d.floor.width, d.floor.depth).world([u, v]),
            q = new T.Vector3(world.x, 0, world.z).project(
              window.sceneEditor.view().presentation!.camera,
            ),
            rect = document.querySelector('#viewport')!.getBoundingClientRect();
          return {
            x: rect.left + ((q.x + 1) * rect.width) / 2,
            y: rect.top + ((1 - q.y) * rect.height) / 2,
          };
        },
        [u, v],
      );
      await page.mouse.click(p.x, p.y);
    };
    await page.locator('#ground-assistance > summary').click();
    await page.locator('[data-ground-mode=ai-box]').click();
    const canvas = page.locator('#viewport'),
      rect = (await canvas.boundingBox())!;
    await page.mouse.move(rect.x + 350, rect.y + 200);
    await page.mouse.down();
    await page.mouse.move(rect.x + 400, rect.y + 250);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!,
        capture = canvas.setPointerCapture.bind(canvas);
      // The synthetic second contact has no native capture; the first remains real.
      canvas.setPointerCapture = (id) => {
        if (id !== 2) capture(id);
      };
      try {
        for (const [type, x, y] of [
          ['pointerdown', 450, 300],
          ['pointermove', 500, 350],
          ['pointerup', 500, 350],
        ] as const)
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 2,
              button: 0,
              clientX: x,
              clientY: y,
            }),
          );
      } finally {
        canvas.setPointerCapture = capture;
      }
    });
    await canvas.dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(selections).toBe(0);
    await page.locator('[data-ground-mode=ai-point]').click();
    await clickUV(0.58, 0.45);
    await page.locator('#ground-refine').click();
    await expect(page.locator('#ground-ai-state')).toContainText('Selection ready');
    expect(selections).toBe(2);
    expect(
      await page.evaluate(() => window.sceneEditor.state().document.groundInteraction),
    ).toBeUndefined();
    await page.locator('#ground-region-name').fill('');
    await page.locator('#ground-accept').click();
    await expect(page.locator('#validation-errors')).toBeVisible();
    expect(
      await page.evaluate(() => window.sceneEditor.state().document.groundInteraction),
    ).toBeUndefined();
    await page.locator('#ground-region-name').fill('Tree');
    await page.locator('#ground-accept').click();
    await expect
      .poll(() =>
        page.evaluate(() => window.sceneEditor.state().document.groundInteraction?.regions.length),
      )
      .toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.sceneEditor.state().document.groundInteraction!.regions[0]!.mask,
        ),
      )
      .toEqual(mask);
    const accepted = await page.evaluate(() =>
      JSON.stringify(window.sceneEditor.state().document.groundInteraction!.regions[0]!.mask),
    );
    await expect(page.locator('.ground-overlay path')).toHaveCount(0);
    await page.getByText('Overlays', { exact: true }).click();
    await page.locator('#ground-show-masks').check();
    await expect(page.locator('.ground-overlay path')).not.toHaveCount(0);
    // Walking must leave mask editing available.
    await page.locator('#viewport').focus();
    await page.keyboard.down('w');
    await page.waitForFunction(() => window.sceneEditor.view().sim!.hero.state === 'walk');
    await page.keyboard.up('w');
    await page.locator('#ground-task').selectOption('brush-erase');
    await clickUV(0.58, 0.45);
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.stringify(window.sceneEditor.state().document.groundInteraction!.regions[0]!.mask),
        ),
      )
      .not.toBe(accepted);
    expect(selections).toBe(2);
    await page.locator('[data-ground-mode=footprint]').click();
    for (const [u, v] of [
      [0.54, 0.52],
      [0.565, 0.52],
      [0.59, 0.52],
    ])
      await clickUV(u!, v!);
    await page.locator('#ground-finish').click();
    await expect(page.locator('#validation-errors')).toContainText('simple nondegenerate polygon');
    await clickUV(0.59, 0.56);
    await page.locator('#ground-finish').click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.sceneEditor.state().document.groundInteraction!.regions[0]!.footprint?.length,
        ),
      )
      .toBe(4);
    await page.locator('[data-ground-mode=anchor]').click();
    await clickUV(0.56, 0.58);
    await expect.poll(() => page.evaluate(() => window.sceneEditor.state().dirty)).toBe(true);
    const authored = await page.evaluate(
      () => window.sceneEditor.state().document.groundInteraction,
    );
    await page.locator('#undo').click();
    await page.locator('#redo').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.groundInteraction))
      .toEqual(authored);
    await page.locator('#ground-find').click();
    await expect(page.locator('#ground-ai-state')).toContainText('1 scenery proposals');
    await page.locator('#ground-prepare').click();
    await expect(page.locator('#ground-ai-state')).toContainText('1 masks prepared');
    await page
      .locator('#ground-assistance')
      .getByRole('button', { name: 'Refine prepared mask' })
      .click();
    await clickUV(0.58, 0.45);
    await page.locator('#ground-accept-batch').click();
    await expect
      .poll(() =>
        page.evaluate(() => window.sceneEditor.state().document.groundInteraction?.regions.length),
      )
      .toBe(2);
    expect(
      await page.evaluate(
        () => window.sceneEditor.state().document.groundInteraction!.regions[1]!.mask,
      ),
    ).not.toEqual(mask);
    await page.locator('#undo').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.groundInteraction))
      .toEqual(authored);
    await page.locator('#document-menu > summary').click();
    await page.locator('#save-as').click();
    await page.locator('#file-id').fill(id);
    const savedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/__lantern_editor') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON().document?.id === id,
      { timeout: 30_000 },
    );
    await page.locator('#confirm-save').click();
    const response = await savedResponse;
    expect(response.ok(), await response.text()).toBe(true);
    await expect(page.locator('#save-state')).toHaveText('Saved');
    const saved = await readJson(file);
    expect(saved.groundInteraction).toEqual(authored);
    const archive = await (await request.get('/__lantern_editor?groundProfiles')).json();
    profileId = archive.profiles.find((p: { name: string }) => p.name.includes(id))?.id;
    expect(profileId).toBeTruthy();
    const data = await (await request.get('/__lantern_editor?id=' + id)).json();
    expect(data.document.groundInteraction).toEqual(authored);
    // Recreate a deleted scene from its independent artwork interaction revision.
    await fs.rm(file);
    await page.locator('#scene-tab').click();
    if ((await page.locator('#ground-interaction-section').getAttribute('open')) === null)
      await page.locator('#ground-interaction-section > summary').click();
    await page.locator('.region-menu > summary').click();
    await page.locator('#ground-clear').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.groundInteraction))
      .toBeUndefined();
    const profileList = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).searchParams.has('groundProfiles'),
      { timeout: 30_000 },
    );
    await page.getByText('Saved interaction profiles', { exact: true }).click();
    await page.locator('#ground-load-profiles').click();
    const listed = await profileList;
    expect(listed.ok(), await listed.text()).toBe(true);
    await expect(page.locator('#ground-profile option[value="' + profileId + '"]')).toHaveCount(1);
    await page.locator('#ground-profile').selectOption(profileId!);
    await page.locator('#ground-restore-profile').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.groundInteraction))
      .toEqual(authored);
    await page.locator('#undo').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.groundInteraction))
      .toBeUndefined();
    await page.locator('#redo').click();
    await expect
      .poll(() => page.evaluate(() => window.sceneEditor.state().document.groundInteraction))
      .toEqual(authored);
    const before = await page.evaluate(() => ({
      draft: window.sceneEditor.state().document,
      storage: Object.entries(localStorage).filter(
        ([key]) => !key.startsWith('lantern-scene-editor'),
      ),
    }));
    await page.locator('#ground-test-movement').click();
    await page.waitForFunction(() => window.sceneEditor.playtest()?.ready);
    expect((await page.evaluate(() => window.sceneEditor.playtest()))!.actors.length).toBe(4);
    const enemyId = await page.evaluate(
      () => window.sceneEditor.playtest()!.actors.find((actor) => actor.id !== 'player')!.id,
    );
    await page.locator('#movement-actor').selectOption(enemyId);
    await page.locator('#playtest-viewport').click({ position: { x: 350, y: 250 } });
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.sceneEditor.playtest()!.navigation.routes.some((r) => r.id === id),
          enemyId,
        ),
      )
      .toBe(true);
    await page.locator('#movement-actor').selectOption('player');
    const x = (await page.evaluate(() => window.sceneEditor.playtest()))!.hero.x;
    await page.keyboard.down('KeyD');
    await expect.poll(() => page.evaluate(() => window.sceneEditor.playtest()!.hero.x)).not.toBe(x);
    await page.keyboard.up('KeyD');
    await page.locator('#playtest-reset').click();
    await page.waitForFunction(() => window.sceneEditor.playtest()?.ready);
    await page.locator('#playtest-return').click();
    expect(await page.evaluate(() => window.sceneEditor.state().document)).toEqual(before.draft);
    expect(
      await page.evaluate(() =>
        Object.entries(localStorage).filter(([key]) => !key.startsWith('lantern-scene-editor')),
      ),
    ).toEqual(before.storage);
    await expect(page.locator('#ground-show-masks')).toBeChecked();
    await page.reload();
    await waitForEditor(page);
    for (const key of ['blockers', 'masks', 'depth'])
      await expect(page.locator('#ground-show-' + key)).not.toBeChecked();
  } finally {
    await fs.rm(file, { force: true });
    if (profileId)
      await fs.rm(path.join(projectRoot, 'authoring/ground-profiles', profileId + '.json'), {
        force: true,
      });
  }
});
