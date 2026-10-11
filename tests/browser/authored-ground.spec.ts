import { test, expect } from './fixtures';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {} from '../../src/editor/main';

test('authored ground opens and routes its actors through saved annotations', async ({
  page,
}, info) => {
  const id = process.env.LANTERN_GROUND_SCENE;
  test.skip(!id, 'Opt in with LANTERN_GROUND_SCENE and prepared local scene artwork');
  test.setTimeout(600_000);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/editor.html?automated');
  await page.waitForFunction(() => window.sceneEditor?.ready());
  if (await page.getByRole('button', { name: 'Dismiss', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.locator('#document-menu > summary').click();
  await page.locator('#scene').selectOption('file-' + id!);
  const started = Date.now();
  await page.locator('#open').click();
  await page.locator('#confirmation-accept').click();
  await expect
    .poll(() => page.evaluate(() => window.sceneEditor.state().document.id), {
      timeout: 90_000,
    })
    .toBe(id);
  await page.waitForFunction(() => window.sceneEditor.view().presentation?.groundOcclusion);
  const openMilliseconds = Date.now() - started;
  const original = await page.evaluate(() => JSON.stringify(window.sceneEditor.state().document));
  const atlas = await page.evaluate(() => {
    const p = window.sceneEditor.view().presentation!;
    const gl = p.renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      bytes: p.groundOcclusion!.bytes,
      maxTextureSize: p.renderer.capabilities.maxTextureSize,
      renderer: debug
        ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER)),
    };
  });
  if (process.env.LANTERN_TEST_GPU === 'hardware')
    expect(atlas.renderer).not.toMatch(/swiftshader|llvmpipe|software/i);
  await page.screenshot({ path: info.outputPath('editor.png') });
  await page.locator('#test-movement').click();
  await page.waitForFunction(() => window.sceneEditor.playtest()?.ready);
  await expect(page.locator('#movement-actor option')).toHaveCount(4);
  const targets = await page.evaluate(() =>
    window.sceneEditor
      .state()
      .document.groundInteraction!.destinations.map((p, i) => ({
        value: String(i),
        name: p.name,
        reachable: p.reachable ?? p.name !== 'Blocked island',
      })),
  );
  await expect(page.locator('#movement-destination option')).toHaveCount(targets.length + 1);
  const routes = [];
  for (const target of targets) {
    await page.locator('#movement-destination').selectOption(target.value);
    await expect(page.locator('#movement-route-status')).toHaveText(
      target.reachable ? 'Following route' : 'Destination unreachable',
    );
    routes.push({
      name: target.name,
      status: await page.locator('#movement-route-status').textContent(),
    });
  }
  const frameIntervals = await page.evaluate(async () => {
    const samples: number[] = [];
    let last = 0;
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        if (last) samples.push(now - last);
        last = now;
        if (samples.length < 120) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    return samples.sort((a, b) => a - b);
  });
  await page.screenshot({ path: info.outputPath('movement.png') });
  await page.locator('#playtest-return').click();
  expect(await page.evaluate(() => JSON.stringify(window.sceneEditor.state().document))).toBe(
    original,
  );
  await fs.writeFile(
    path.join(info.outputDir, 'metrics.json'),
    JSON.stringify(
      {
        id,
        openMilliseconds,
        atlas,
        routes,
        rendererFrameIntervals: {
          count: frameIntervals.length,
          p50: frameIntervals[60],
          p95: frameIntervals[114],
          max: frameIntervals.at(-1),
        },
      },
      null,
      2,
    ),
  );
});
