import { rectangle } from '../fixtures/ground';
import { stateTest as test, expect, waitForEditorIdle, openEditor } from './fixtures';
import { importEditorScene, readEditorDocument, expectEditorDocument } from './editor-driver';
import { readJson } from '../../tools/json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot } from '../../tools/assets/paths';
import { emptyScene } from '../../src/editor/default-scene';

test('ground authoring accepts a refined mask, supports brush undo and restores its saved profile', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const id = 'ground-proof-' + Date.now(),
    file = path.join(projectRoot, 'authoring/scenes', id + '.json');
  const mask = [
    {
      outer: rectangle(0.53, 0.3, 0.65, 0.6),
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
    await importEditorScene(page, d, 'fixture.json');
    await expectEditorDocument(page, (document) => document.floor.layout, {
      timeout: 30_000,
    }).toBe('artwork');
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
    await page.locator('[data-ground-mode=ai-point]').click();
    await clickUV(0.58, 0.45);
    await page.locator('#ground-refine').click();
    await expect(page.locator('#ground-ai-state')).toContainText('Selection ready');
    expect(selections).toBe(2);
    expect(
      await readEditorDocument(page, (document) => document.groundInteraction),
    ).toBeUndefined();
    await page.locator('#ground-region-name').fill('Tree');
    await page.locator('#ground-accept').click();
    await expectEditorDocument(page, (document) => document.groundInteraction?.regions.length).toBe(
      1,
    );
    await expectEditorDocument(
      page,
      (document) => document.groundInteraction!.regions[0]!.mask,
    ).toEqual(mask);
    const accepted = await readEditorDocument(page, (document) =>
      JSON.stringify(document.groundInteraction!.regions[0]!.mask),
    );
    await expect(page.locator('.ground-overlay path')).toHaveCount(0);
    await page.getByText('Overlays', { exact: true }).click();
    await page.locator('#ground-show-masks').check();
    await expect(page.locator('.ground-overlay path')).not.toHaveCount(0);
    await page.locator('#ground-task').selectOption('brush-erase');
    await clickUV(0.58, 0.45);
    await expectEditorDocument(page, (document) =>
      JSON.stringify(document.groundInteraction!.regions[0]!.mask),
    ).not.toBe(accepted);
    expect(selections).toBe(2);
    const authored = await readEditorDocument(page, (document) => document.groundInteraction);
    await page.locator('#undo').click();
    await page.locator('#redo').click();
    await expectEditorDocument(page, (document) => document.groundInteraction).toEqual(authored);
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
    await waitForEditorIdle(page);
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
    await expectEditorDocument(page, (document) => document.groundInteraction).toBeUndefined();
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
    await expectEditorDocument(page, (document) => document.groundInteraction, {
      timeout: 60_000,
    }).toEqual(authored);
    await waitForEditorIdle(page);
    await page.locator('#undo').click();
    await expectEditorDocument(page, (document) => document.groundInteraction).toBeUndefined();
    await page.locator('#redo').click();
    await expectEditorDocument(page, (document) => document.groundInteraction).toEqual(authored);
  } finally {
    await fs.rm(file, { force: true });
    if (profileId)
      await fs.rm(path.join(projectRoot, 'authoring/ground-profiles', profileId + '.json'), {
        force: true,
      });
  }
});

test('editor rejects an upright prop on painted collision without changing the accepted document', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await openEditor(page);
  const scene = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'authoring/scenes/abandoned-orchard.json'), 'utf8'),
  );
  scene.groundInteraction.regions.push({
    id: 'blocked-placement',
    name: 'Blocked placement',
    footprint: rectangle(12.4, -2.4, 12.6, -2.2).map(([x, z]) => ({ x, z })),
  });
  await importEditorScene(page, scene, 'orchard.json');
  await expectEditorDocument(page, (document) => document.name, { timeout: 90_000 }).toBe(
    'Imported ' + scene.name,
  );
  await waitForEditorIdle(page);
  const count = scene.objects.length;
  await page.locator('#artwork-tab').click();
  await page.locator('#art-filters > summary').click();
  await page.locator('#asset-scope').selectOption('all');
  await page.locator('#category').selectOption('all');
  await page.locator('#collection').selectOption('all');
  await page.locator('#search').fill('ink-blackwood-oak');
  await page.locator('#assets button.asset[title^="ink-blackwood-oak/"]').click();
  await expect(page.locator('#place-clip')).toHaveValue('oak');
  const point = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js';
    const { Vector3 } = await import(threePath);
    return window.sceneEditor.view().screen(new Vector3(12.5, 0, -2.3));
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#validation-errors')).toContainText('Placement needs clear ground');
  expect(await readEditorDocument(page, (document) => document.objects.length)).toBe(count);
  if (process.env.LANTERN_OPENING_CAPTURE_DIRECTORY)
    await page.screenshot({
      path: path.join(
        process.env.LANTERN_OPENING_CAPTURE_DIRECTORY,
        'editor-placement-rejected.png',
      ),
    });
});
