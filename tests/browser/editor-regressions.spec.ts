import { changeField, importEditorScene, expectEditorDocument } from './editor-driver';
import { expectPageValue, test, expect, openEditor } from './fixtures';
import type { Page } from '@playwright/test';
import type { GroundAuthoring } from '../../src/editor/ground-authoring';
import type { SceneDocument } from '../../src/content/scene-document';
import type { OrthographicCamera } from 'three';
import type { EditorView } from '../../src/editor/view';

declare global {
  interface Window {
    groundRegression: {
      authoring: GroundAuthoring;
      document: SceneDocument;
      camera: OrthographicCamera;
      pointer?: number;
    };
  }
}

test.beforeEach(async ({ page }) => {
  // setContent after the JSON identity endpoint retains application/json and
  // its browser viewer. Mount a real HTML document on the Vite origin.
  await page.route('**/__ground_regression', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><style>body{margin:0}#scene-panel{position:absolute;left:820px;top:0;width:440px;height:780px;overflow:auto}canvas{width:800px;height:600px}#stage{position:relative;width:800px;height:600px}.ground-overlay{position:absolute;pointer-events:none}</style><section id="scene-panel"></section><div id="stage"><canvas id="viewport" width="800" height="600"></canvas></div><p id="feedback"></p>',
    }),
  );
  await page.goto('/__ground_regression');
  expect(await page.evaluate(() => document.contentType)).toBe('text/html');
  await page.evaluate(async () => {
    const authoringPath = '/src/editor/ground-authoring.ts',
      cameraPath = '/src/presentation/camera.ts',
      scenePath = '/src/content/scene-document.ts',
      defaultPath = '/src/editor/default-scene.ts',
      uiPath = '/src/editor/ui.ts',
      gesturesPath = '/src/editor/gestures.ts',
      groundPath = '/tests/fixtures/ground.ts';
    const [
      { GroundAuthoring },
      { makeCamera },
      { parseSceneDocument },
      { emptyScene },
      { editorUI },
      { EditorGestures },
      { rectangle },
    ] = await Promise.all([
      import(authoringPath),
      import(cameraPath),
      import(scenePath),
      import(defaultPath),
      import(uiPath),
      import(gesturesPath),
      import(groundPath),
    ]);
    const template = document.createElement('template');
    template.innerHTML = editorUI;
    document
      .querySelector('#scene-panel')!
      .append(template.content.querySelector('#ground-interaction-section')!);
    const scene = emptyScene();
    scene.floor.layout = 'artwork';
    scene.groundInteraction = {
      asset: 'ink-moss',
      frame: 'ground',
      hash: 'a'.repeat(64),
      dimensions: [64, 64],
      destinations: [],
      regions: [
        {
          id: 'region',
          name: 'Region',
          mask: [
            {
              outer: rectangle(0.48, 0.48, 0.52, 0.52),
              holes: [],
            },
          ],
          depth: { kind: 'anchor', point: { x: 0, z: 0 } },
        },
      ],
    };
    const state = (window.groundRegression = {
      document: parseSceneDocument(scene),
      camera: makeCamera(4 / 3),
      authoring: undefined as unknown as GroundAuthoring,
    });
    const view = {
      presentation: { camera: state.camera },
      render() {
        state.authoring.draw();
      },
    } as unknown as EditorView;
    state.authoring = new GroundAuthoring(document.querySelector('canvas')!, {
      gestures: new EditorGestures(),
      document: () => state.document,
      view: () => view,
      manifest: () => undefined,
      async change(work: (draft: SceneDocument) => void) {
        const draft = parseSceneDocument(state.document);
        work(draft);
        state.document = parseSceneDocument(draft);
        state.authoring.draw();
      },
      status(message: string) {
        document.querySelector('#feedback')!.textContent = message;
      },
      async request() {
        throw new Error('No selection service needed');
      },
    });
    state.authoring.draw();
    document.querySelector('#ground-interaction-section')!.setAttribute('open', '');
  });
  await page.locator('#ground-region').selectOption('region');
  await page.getByText('Overlays', { exact: true }).click();
  await page.locator('.region-menu > summary').click();
});

test('ground overlays follow projection changes without camera translation', async ({ page }) => {
  await page.locator('#ground-show-masks').check();
  await page.evaluate(() => window.groundRegression.authoring.draw());
  const before = await page.locator('.ground-overlay path').getAttribute('d');
  await page.evaluate(() => {
    const { camera, authoring } = window.groundRegression;
    camera.top *= 0.8;
    camera.bottom *= 0.8;
    camera.left *= 0.8;
    camera.right *= 0.8;
    camera.updateProjectionMatrix();
    authoring.draw();
  });
  await expect(page.locator('.ground-overlay path')).not.toHaveAttribute('d', before!);
});

async function beginAnchorDrag(page: Page) {
  await page.bringToFront();
  await page.locator('#ground-show-depth').check();
  const canvas = page.locator('#viewport');
  const rect = await canvas.boundingBox();
  if (!rect) throw new Error('Ground canvas is unavailable');
  await page.evaluate(() => {
    window.addEventListener(
      'pointerdown',
      (event) => {
        window.groundRegression.pointer = event.pointerId;
      },
      { capture: true, once: true },
    );
  });
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  const pointerId = await page.evaluate(() => window.groundRegression.pointer);
  if (pointerId === undefined) throw new Error('Ground drag received no pointerdown');
  await expect
    .poll(() => canvas.evaluate((node, pointer) => node.hasPointerCapture(pointer), pointerId))
    .toBe(true);
  return { pointerId, rect };
}

test('cancelled ground drags discard edits and release pointer capture', async ({ page }) => {
  const { pointerId, rect } = await beginAnchorDrag(page);
  await page.locator('#viewport').dispatchEvent('pointercancel', { pointerId });
  await expect.soft
    .poll(() =>
      page
        .locator('#viewport')
        .evaluate((canvas, pointer) => canvas.hasPointerCapture(pointer), pointerId),
    )
    .toBe(false);
  await page.mouse.move(rect.x + 435, rect.y + 320);
  await page.mouse.up();
  expect(
    await page.evaluate(
      () => window.groundRegression.document.groundInteraction!.regions[0]!.depth,
    ),
  ).toEqual({ kind: 'anchor', point: { x: 0, z: 0 } });
});

test('ground drags commit the release location without a final pointermove', async ({ page }) => {
  const { pointerId, rect } = await beginAnchorDrag(page);
  await page
    .locator('#viewport')
    .dispatchEvent('pointerup', { pointerId, clientX: rect.x + 430, clientY: rect.y + 315 });
  await page.mouse.up();
  const projected = await page.evaluate(async () => {
    const threePath = '/node_modules/.vite/deps/three.js';
    const T = await import(threePath);
    const { camera, document: scene } = window.groundRegression;
    const depth = scene.groundInteraction!.regions[0]!.depth;
    if (depth?.kind !== 'anchor') throw new Error('Expected anchor');
    const point = new T.Vector3(depth.point.x, 0, depth.point.z).project(camera);
    return { x: (point.x + 1) * 400, y: (1 - point.y) * 300 };
  });
  expect(projected.x).toBeCloseTo(430, 3);
  expect(projected.y).toBeCloseTo(315, 3);
});

test('ground regions with maximum-length names can be duplicated', async ({ page }) => {
  await changeField(page.locator('#ground-region-name'), 'R'.repeat(80));
  await page.locator('#ground-duplicate').click();
  await expectPageValue(
    page,
    () => window.groundRegression.document.groundInteraction!.regions.length,
  ).toBe(2);
  const name = await page.evaluate(
    () => window.groundRegression.document.groundInteraction!.regions[1]!.name,
  );
  expect(name).toHaveLength(80);
  expect(name.endsWith(' copy')).toBe(true);
});

test('native templates preserve text, attributes and live controls without parsing authored markup', async ({
  page,
}) => {
  await openEditor(page);
  expect(
    await page.evaluate(async () => {
      const moduleURL = '/src/dom.ts';
      const { html } = (await import(moduleURL)) as typeof import('../../src/dom');
      const name = '<img src=x onerror="throw 1"> & "quoted"';
      const button = html<HTMLButtonElement>`<button>${name}</button>`;
      let clicks = 0;
      button.onclick = () => clicks++;
      const node = html`<section title="${name}">${[button, html`<span>${name}</span>`]}${false}${undefined}</section>`;
      button.click();
      return {
        title: node.title,
        text: node.textContent,
        images: node.querySelectorAll('img').length,
        same: node.firstChild === button,
        clicks,
      };
    }),
  ).toEqual({
    title: '<img src=x onerror="throw 1"> & "quoted"',
    text: '<img src=x onerror="throw 1"> & "quoted"'.repeat(2),
    images: 0,
    same: true,
    clicks: 1,
  });
});

test('authoring controls preserve draw order, elevated focus and collision footprints', async ({
  page,
}) => {
  await openEditor(page);
  const moduleURL = '/src/editor/default-scene.ts';
  const scene = await page.evaluate(async (url) => {
    const { emptyScene } = await import(url);
    const d = emptyScene();
    d.objects = ['supplies', 'other'].map((id, i) => ({
      id,
      kind: 'prop',
      asset: 'ink-scenery',
      clip: 'lantern',
      x: i * 3,
      z: 1,
    }));
    d.objects[0] = {
      ...d.objects[0],
      x: 3,
      z: 3,
      y: 3,
      footprint: [4, 1],
      footprintAngle: Math.PI / 2,
    };
    d.geometry = {
      bounds: d.camera.bounds,
      surface: { kind: 'flat', height: 5 },
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 0 }],
    };
    d.propOrder = ['supplies'];
    return d;
  }, moduleURL);
  await importEditorScene(page, scene);
  await expectEditorDocument(page, (d) => d.objects.length).toBe(2);
  await page.locator('#scene-tab').click();
  await page.locator('[data-section="category-Advanced"] > summary').click();
  await page.locator('[data-section="propOrder"] > summary').click();
  await page.getByRole('button', { name: 'Add Draw order', exact: true }).click();
  await expectEditorDocument(page, (d) => d.propOrder).toEqual(['supplies', 'other']);
  await page.locator('#objects-tab').click();
  await page.getByRole('button', { name: 'Focus supplies', exact: true }).click();
  expect(await page.evaluate(() => window.sceneEditor.view().presentation!.center.y)).toBe(9.8);
  await page.locator('#view-menu > summary').click();
  await page.locator('[data-overlay="collision"]').check();
  const extent = await page.evaluate(() => {
    const overlay = window.sceneEditor.view().presentation!.overlay;
    const line = overlay.children
      .flatMap((group) => group.children)
      .find((child) => child.type === 'Line') as import('three').Line;
    const points = line.geometry.getAttribute('position');
    const xs = Array.from({ length: points.count }, (_, i) => points.getX(i));
    const zs = Array.from({ length: points.count }, (_, i) => points.getZ(i));
    return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)];
  });
  expect(extent).toEqual([1, 4]);
});
