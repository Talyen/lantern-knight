import fs from 'node:fs/promises';
import path from 'node:path';
import { pixelTest as test, expect, openEditor, waitForEditorIdle } from './fixtures';
import { importEditorScene, expectEditorDocument } from './editor-driver';
import { parseSceneDocument } from '../../src/content/scene-document';
import { readRound, readJSON, sha256 } from '../../tools/scene-placement/session';

test('capture a blinded placement comparison without saving either scene', async ({ page }) => {
  const directory = process.env.LANTERN_PLACEMENT_ROUND;
  test.skip(!directory, 'Explicit placement comparison only');
  if (!directory) return;
  test.setTimeout(360_000);
  const { round, hash } = await readRound(directory);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Both imports begin from the same deterministic clock and random stream.
  await page.addInitScript(() => {
    let seed = 1729;
    Math.random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
    const frame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => frame(() => callback(0));
  });
  const framing: unknown[] = [];
  let renderer = '';
  for (const [index, variant] of round.labels.entries()) {
    await openEditor(page);
    const scene = parseSceneDocument(await readJSON(path.join(directory, variant + '.json')));
    await importEditorScene(page, scene);
    await page.waitForFunction(
      (name) => {
        const error = document.querySelector('#validation-errors')?.textContent;
        if (error) throw new Error(error);
        return window.sceneEditor.state().document.name === 'Imported ' + name;
      },
      scene.name,
      { timeout: 90_000 },
    );
    await waitForEditorIdle(page);
    await expectEditorDocument(page, (document) => document.objects).toEqual(scene.objects);
    await expectEditorDocument(page, (document) => document.gameplay?.spawns).toEqual(
      scene.gameplay?.spawns,
    );
    // The editor import resolves manifests and full-art clearance before accepting.
    await expect(page.locator('#validation-errors')).toBeEmpty();
    await page.addStyleTag({
      content: `
      body{margin:0!important;overflow:hidden!important}
      header,.dock,.toolbar,#canvas-hint,#status,#validation-errors,#transform-handles,#marquee{display:none!important}
      .viewport{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;padding:0!important}
      #viewport{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;outline:none!important}
    `,
    });
    const result = await page.evaluate((viewSpec) => {
      const view = window.sceneEditor.view();
      const p = view.presentation!;
      view.setAnimationPlaying(false);
      view.replayAnimations();
      view.setGrid(false);
      view.select(undefined);
      view.hero(viewSpec.hero);
      p.gameCamera = false;
      p.center.set(viewSpec.center.x, 0, viewSpec.center.z);
      p.verticalSpan = viewSpec.verticalSpan;
      p.resize();
      view.render(0);
      const gl = p.renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        center: p.viewTarget.toArray(),
        span: p.verticalSpan,
        width: innerWidth,
        height: innerHeight,
        renderer: String(
          debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        ),
      };
    }, round.spec.view);
    renderer = result.renderer;
    if (process.env.LANTERN_TEST_GPU === 'hardware')
      expect(renderer).not.toMatch(/swiftshader|llvmpipe|software/i);
    framing.push(result);
    await page
      .locator('#viewport')
      .screenshot({ path: path.join(directory, index === 0 ? 'A.png' : 'B.png') });
  }
  expect(framing[0]).toEqual(framing[1]);
  const images = await Promise.all(
    ['A', 'B'].map(async (label) =>
      sha256(await fs.readFile(path.join(directory, label + '.png'))),
    ),
  );
  expect(
    images[0],
    'No visible change at this camera; choose a useful view before asking the human',
  ).not.toBe(images[1]);
  await fs.writeFile(
    path.join(directory, 'capture-pending.json'),
    JSON.stringify(
      {
        round: hash,
        renderer,
        assets: process.env.LANTERN_ASSET_SHA256,
        gpu: process.env.LANTERN_TEST_GPU === 'hardware' ? 'hardware' : 'software',
        images,
        framing,
      },
      null,
      2,
    ) + '\n',
  );
});
