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
    expectedFailures = new Set<string>(),
    id = 'editor-check-' + randomUUID(),
    file = path.join(projectRoot, 'authoring/scenes', id + '.json'),
    lampId = id + '-lamps',
    lampFile = path.join(projectRoot, 'authoring/scenes', lampId + '.json');
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !(expectedFailures.has(message.location().url) && message.text().includes('503')) &&
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
        s = v.presentation!.roomPresentation.inkRoom!.sprites.find(
          (s) => s.id === d.objects[0]!.id,
        )!;
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
        Math.abs(window.sceneEditor.state().document.objects[0]!.x! - 2) > 0.1 &&
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
    const metadataResources = () =>
      page.evaluate(() => {
        const view = window.sceneEditor.view();
        return {
          generation: view.sim!.generation,
          hero: view.presentation!.actorPresentation.actors.get(view.sim!.hero.id)!.sprite.mesh
            .uuid,
        };
      });
    const beforeMetadata = await metadataResources();
    await page.locator('#rig').selectOption('silver');
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.look.rig === 'silver' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.deepEqual(
      await metadataResources(),
      beforeMetadata,
      'Lighting-only edits should preserve the scene and actor resources',
    );
    const metadataTiming = await page.evaluate(async () => {
      const view = window.sceneEditor.view(),
        scene = structuredClone(window.sceneEditor.state().document),
        canvas = document.createElement('canvas');
      canvas.width = view.canvas.width;
      canvas.height = view.canvas.height;
      const context = canvas.getContext('2d')!,
        samples = [];
      let before: Uint8ClampedArray | undefined;
      for (const rebuild of [true, false]) {
        const generation = view.sim!.generation;
        const start = performance.now();
        for (let index = 0; index < 12; index++) {
          if (rebuild) (view as unknown as { composition?: string }).composition = undefined;
          await view.apply({
            ...scene,
            look: { ...scene.look, rig: index % 2 ? 'silver' : 'golden' },
          });
          view.setGrid(false);
          view.render();
        }
        samples.push(performance.now() - start);
        if (view.sim!.generation !== generation + (rebuild ? 12 : 0))
          throw new Error('Metadata benchmark did not exercise its declared rebuild/reuse path');
        context.drawImage(view.canvas, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        if (before) {
          let difference = 0;
          for (let index = 0; index < pixels.length; index++)
            difference = Math.max(difference, Math.abs(pixels[index]! - before[index]!));
          if (difference)
            throw new Error('Metadata resource reuse changed frozen pixels: ' + difference);
        } else before = pixels;
      }
      return { rebuildMs: Math.round(samples[0]!), reuseMs: Math.round(samples[1]!) };
    });
    console.log(
      `Metadata edits: 12 rebuilds ${metadataTiming.rebuildMs}ms; 12 reused updates ${metadataTiming.reuseMs}ms; frozen pixels identical.`,
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
    await page.locator('#undo').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.look.rig === 'golden' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(await page.evaluate(() => window.sceneEditor.state().document.id), id);
    assert.equal(await page.evaluate(() => window.sceneEditor.state().dirty), true);
    await page.locator('#save').click();
    await page.waitForFunction(
      () =>
        !window.sceneEditor.state().dirty &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#redo').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.look.rig === 'silver' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(await page.evaluate(() => window.sceneEditor.state().document.id), id);
    assert.equal(await page.evaluate(() => window.sceneEditor.state().dirty), true);
    await page.locator('#save').click();
    await page.waitForFunction(
      () =>
        !window.sceneEditor.state().dirty &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#objects button').first().click();
    await page.locator('#x').fill('3');
    await page.locator('#x').press('Tab');
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects[0]!.x === 3 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage))
        if (key.startsWith('lantern-scene-editor-recovery:')) {
          const recovery = JSON.parse(localStorage.getItem(key)!);
          recovery.baseRevision = '0'.repeat(64);
          localStorage.setItem(key, JSON.stringify(recovery));
        }
    });
    await page.reload();
    await page.waitForFunction(() => window.sceneEditor?.ready(), {}, { timeout: 45000 });
    await page.locator('#restore').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects[0]?.x === 3 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#save').click();
    await page.waitForFunction(
      () =>
        !window.sceneEditor.state().dirty &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(
      JSON.parse(await fs.readFile(file, 'utf8')).objects[0].x,
      3,
      'Recovery validated against current foundations must remain saveable after review',
    );
    const external = { ...saved, name: 'Changed by an agent' };
    await fs.writeFile(file, JSON.stringify(external, null, 2) + '\n');
    await page.locator('#save').click();
    await page.locator('#conflict').waitFor({ state: 'visible' });
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).name, external.name);
    assert.equal(await page.evaluate(() => window.sceneEditor.state().document.objects[0]!.x), 3);
    const beforeFailedOpen = await page.evaluate(() => window.sceneEditor.state());
    const failedURLs = new Set(
      await page.evaluate(async () => {
        const runtime = window.sceneEditor.view().runtime,
          manifest = await runtime.manifest('ink-chapel-floor'),
          file = runtime.catalog['ink-chapel-floor']!,
          directory = '/' + file.slice(0, file.lastIndexOf('/') + 1);
        return manifest.pages.map((page) => new URL(directory + page.path, location.origin).href);
      }),
    );
    const failedAsset = (url: URL) => failedURLs.has(url.href);
    await page.route(failedAsset, async (route) => {
      expectedFailures.add(route.request().url());
      await route.fulfill({ status: 503, body: 'Deliberate scene-loading failure' });
    });
    await page.locator('#scene').selectOption('copy-upper-landing');
    await page.locator('#open').click();
    await page.waitForFunction(
      () =>
        document.querySelector('#status')?.textContent?.includes('HTTP 503') &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.ok(expectedFailures.size, 'The failed-open check must actually reject an asset load');
    assert.deepEqual(
      await page.evaluate(() => window.sceneEditor.state()),
      beforeFailedOpen,
      'A failed scene open must preserve the current document, revision and dirty state',
    );
    await page.unroute(failedAsset);
    await page.evaluate(() => {
      const view = window.sceneEditor.view(),
        apply = view.apply;
      view.apply = async () => {
        view.apply = apply;
        throw new Error('Deliberate preview failure');
      };
    });
    await page.locator('#name').fill('Recovered before rendering');
    await page.locator('#name').press('Tab');
    await page.waitForFunction(
      () =>
        document.querySelector('#status')?.textContent === 'Deliberate preview failure' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(
      await page.evaluate(() => {
        const key = Object.keys(localStorage).find((key) =>
          key.startsWith('lantern-scene-editor-recovery:'),
        )!;
        return JSON.parse(localStorage.getItem(key)!).document.name;
      }),
      'Recovered before rendering',
      'Accepted edits must reach recovery even if the preview fails',
    );
    await page.locator('#undo').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.name === 'Untitled scene' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#scene').selectOption('copy-court');
    await page.locator('#open').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.base === 'court' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(await page.evaluate(() => window.sceneEditor.state().document.target), 'draft');
    await page.locator('#objects button').filter({ hasText: 'gate-lamp' }).click();
    assert.equal(await page.locator('#delete').isDisabled(), false);
    const lampSnapshot = await page.evaluate(() =>
      JSON.stringify(window.sceneEditor.state().document),
    );
    await page.locator('#duplicate').click();
    await page.waitForFunction(() =>
      document.querySelector('#status')?.textContent?.includes('three lights'),
    );
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.sceneEditor.state().document)),
      lampSnapshot,
    );
    await page.locator('#x').fill('-4');
    await page.locator('#x').press('Tab');
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects.find((p) => p.id === 'gate-lamp')?.x === -4 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(
      await page.evaluate(
        () => window.sceneEditor.view().presentation!.sceneEffects.stats().fixtures,
      ),
      3,
    );
    await page.locator('#delete').click();
    await page.waitForFunction(
      () =>
        !window.sceneEditor.state().document.objects.some((p) => p.id === 'gate-lamp') &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(
      await page.evaluate(
        () => window.sceneEditor.view().presentation!.sceneEffects.stats().fixtures,
      ),
      2,
    );
    await page.locator('#undo').click();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#save')!.disabled);
    await page.locator('#undo').click();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#save')!.disabled);
    assert.equal(
      await page.evaluate(() => JSON.stringify(window.sceneEditor.state().document)),
      lampSnapshot,
    );
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
    await page.locator('#scene').selectOption('copy-upper-landing');
    await page.locator('#open').click();
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.base === 'upper-landing' &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    await page.locator('#objects button').filter({ hasText: 'crypt-return-door' }).click();
    assert.equal(await page.locator('#delete').isDisabled(), true);
    await page.locator('#objects button').filter({ hasText: 'crypt-altar-candles' }).click();
    assert.equal(await page.locator('#delete').isDisabled(), false);
    await page.locator('#x').fill('0.4');
    await page.locator('#x').press('Tab');
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#save')!.disabled);
    await page
      .locator('#objects button')
      .filter({ hasText: /^crypt-altar$/ })
      .click();
    await page.locator('#x').fill('1');
    await page.locator('#x').press('Tab');
    await page.waitForFunction(
      () =>
        window.sceneEditor.state().document.objects.find((p) => p.id === 'crypt-altar')?.x === 1 &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.sceneEditor
            .view()
            .presentation!.visuals!.props.find((p) => p.id === 'crypt-altar-candles')!.x,
      ),
      1.4,
    );
    await page.locator('#delete').click();
    await page.waitForFunction(
      () =>
        !window.sceneEditor.state().document.objects.some((p) => p.id === 'crypt-altar-candles') &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    assert.equal(
      await page.evaluate(
        () => window.sceneEditor.view().presentation!.sceneEffects.stats().fixtures,
      ),
      2,
    );
    await page.locator('#undo').click();
    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#save')!.disabled);
    assert.equal(
      await page.evaluate(
        () => window.sceneEditor.view().presentation!.sceneEffects.stats().fixtures,
      ),
      3,
    );

    await page.locator('#save-as').click();
    await page.locator('#file-id').fill(lampId);
    await page.locator('#confirm-save').click();
    await page.waitForFunction(
      () =>
        !window.sceneEditor.state().dirty &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
    );
    const lampSaved = await page.evaluate(() => window.sceneEditor.state().document);
    assert.deepEqual(JSON.parse(await fs.readFile(lampFile, 'utf8')), lampSaved);
    await page.reload();
    await page.waitForFunction(() => window.sceneEditor?.ready());
    await page.locator('#scene').selectOption('file-' + lampId);
    await page.locator('#open').click();
    await page.waitForFunction(
      (id) =>
        window.sceneEditor.state().document.id === id &&
        !document.querySelector<HTMLButtonElement>('#save')!.disabled,
      lampId,
    );
    assert.deepEqual(await page.evaluate(() => window.sceneEditor.state().document), lampSaved);
    assert.equal(
      await page.evaluate(
        () =>
          window.sceneEditor
            .view()
            .presentation!.visuals!.props.find((p) => p.id === 'crypt-altar-candles')!.x,
      ),
      1.4,
    );
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
    await fs.rm(lampFile, { force: true });
    await fs.rm(path.join(held.root, 'profile'), { recursive: true, force: true });
    if (passed && !capture) await fs.rm(held.root, { recursive: true, force: true });
    await held.release();
  }
  await requireStableInputs(projectRoot, before);
  console.log(
    'PASS: editor browser placement, inspector, history, save, recovery, conflict protection, editable/mounted lamps, protected foundations and renderer lifetime.',
  );
}
check().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
