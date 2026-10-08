import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { _electron } from 'playwright';
import { scenePreviewServer } from './scene-server';
import { AssetCache } from './assets/cache';
import { projectRoot } from './assets/paths';
import { verificationIdentity, requireStableInputs } from './verification';
import type {} from '../src/editor';
async function check() {
  const capture = process.argv.includes('--capture');
  if (process.argv.slice(2).some((a) => a !== '--capture'))
    throw new Error('Editor check accepts only --capture');
  const before = await verificationIdentity(projectRoot),
    held = await new AssetCache().lease('editor-check-' + randomUUID(), 24 * 1024 ** 2),
    server = await scenePreviewServer();
  const browser = await _electron.launch({
    args: [
      path.join(projectRoot, 'tools/scene-browser.cjs'),
      server.origin + '/editor.html?automated=1',
      path.join(held.root, 'profile'),
    ],
  });
  let passed = false;
  const page = await browser.firstWindow(),
    errors: string[] = [],
    id = 'editor-check-' + randomUUID(),
    file = path.join(projectRoot, 'authoring/scenes', id + '.json');
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !(message.location().url.includes('/__lantern_editor') && message.text().includes('409'))
    )
      errors.push(message.text());
  });
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  try {
    await page.waitForFunction(() => window.sceneEditor?.ready(), {}, { timeout: 45000 });
    console.log('Editor ready.');
    const box = await page.locator('#viewport').boundingBox();
    assert.ok(box);
    await page.locator('#search').fill('gravestone');
    await page
      .locator('.asset')
      .first()
      .dragTo(page.locator('#viewport'), {
        targetPosition: { x: box.width * 0.52, y: box.height * 0.58 },
      });
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects.length === 1 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    const first = await page.evaluate(() => window.sceneEditor.state().document.objects[0]!);
    assert.equal(first.kind, 'prop');
    await page.locator('#x').fill('2');
    await page.locator('#x').press('Tab');
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects[0]!.x === 2 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#mirror').check();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects[0]!.mirror === true &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    const handle = await page.evaluate(() => {
      const v = window.sceneEditor.view(),
        d = window.sceneEditor.state().document,
        s = v.presentation!.inkRoom!.sprites.find((s) => s.id === d.objects[0]!.id)!;
      s.mesh.updateMatrixWorld(true);
      const position = s.geometry.getAttribute('position'),
        corners = Array.from({ length: position.count }, (_, i) =>
          v.screen(
            s.mesh.position
              .clone()
              .fromBufferAttribute(position, i)
              .applyMatrix4(s.mesh.matrixWorld),
          ),
        ),
        minX = Math.min(...corners.map((p) => p.x)),
        maxX = Math.max(...corners.map((p) => p.x)),
        minY = Math.min(...corners.map((p) => p.y)),
        maxY = Math.max(...corners.map((p) => p.y));
      let transparent = false,
        handle: { x: number; y: number } | undefined;
      for (let y = 1; y < 10; y++)
        for (let x = 1; x < 10; x++) {
          const point = { x: minX + ((maxX - minX) * x) / 10, y: minY + ((maxY - minY) * y) / 10 },
            hit = v.pick(point.x, point.y, d);
          if (hit?.placement.id === d.objects[0]!.id) handle ??= point;
          else transparent = true;
        }
      if (!transparent) throw new Error('Picking did not reject transparent artwork margins');
      return handle;
    });
    assert.ok(handle, 'Opaque artwork must be selectable');
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 55, handle.y + 20, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        Math.abs(window.sceneEditor.state().document.objects[0]!.x - 2) > 0.1 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#duplicate').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects.length === 2 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#delete').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects.length === 1 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#undo').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects.length === 2 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#redo').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects.length === 1 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#rig').selectOption('silver');
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.look.rig === 'silver' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#save-as').click();
    await page.locator('#file-id').fill(id);
    await page.locator('#confirm-save').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().revision !== null &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    const saved = await page.evaluate(() => window.sceneEditor.state().document);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), saved);
    await page.locator('#objects button').first().click();
    await page.locator('#x').fill('3');
    await page.locator('#x').press('Tab');
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects[0]!.x === 3 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.reload();
    await page.waitForFunction(() => window.sceneEditor?.ready(), {}, { timeout: 45000 });
    await page.locator('#restore').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects[0]?.x === 3 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    const external = { ...saved, name: 'Changed by an agent' };
    await fs.writeFile(file, JSON.stringify(external, null, 2) + '\n');
    await page.locator('#save').click();
    await page.locator('#conflict').waitFor({ state: 'visible' });
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).name, external.name);
    assert.equal(await page.evaluate(() => window.sceneEditor.state().document.objects[0]!.x), 3);
    await page.locator('#scene').selectOption('copy-court');
    await page.locator('#open').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.base === 'court' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(await page.evaluate(() => window.sceneEditor.state().document.target), 'draft');
    await page.locator('#objects button').filter({ hasText: 'gate-lamp' }).click();
    assert.equal(await page.locator('#delete').isDisabled(), true);
    await page.locator('#objects button').filter({ hasText: 'boundary-oak' }).click();
    assert.equal(await page.locator('#delete').isDisabled(), false);
    const resources = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('#x').fill(String(-7 - i * 0.1));
      await page.locator('#x').press('Tab');
      await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>('#save')!.disabled,
      );
      resources.push(
        await page.evaluate(() => ({
          ...window.sceneEditor.view().presentation!.renderer.info.memory,
        })),
      );
    }
    assert.deepEqual(resources[2], resources[1], 'Scene rebuild leaked GPU resources');
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(() =>
        window.sceneEditor.view().presentation!.renderer.getContext().getError(),
      ),
      0,
    );
    if (capture) {
      await page.locator('#viewport').screenshot({ path: path.join(held.root, 'editor.png') });
      console.log('Editor screenshot: ' + path.join(held.root, 'editor.png'));
    }
    passed = true;
  } catch (error) {
    console.error('Editor diagnostics: ' + held.root);
    console.error('Page status: ' + (await page.locator('#status').textContent()));
    console.error('Browser errors: ' + errors.join('\n'));
    await page.screenshot({ path: path.join(held.root, 'failure.png') });
    throw error;
  } finally {
    await browser.close();
    await server.close();
    await fs.rm(file, { force: true });
    await fs.rm(path.join(held.root, 'profile'), { recursive: true, force: true });
    if (passed && !capture) await fs.rm(held.root, { recursive: true, force: true });
    await held.release();
  }
  await requireStableInputs(projectRoot, before);
  console.log(
    'PASS: editor browser placement, inspector, history, save, recovery, conflict protection, locked fixtures and renderer lifetime.',
  );
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
