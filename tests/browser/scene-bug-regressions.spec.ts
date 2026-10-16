import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// Real keyboard, focus and dialog behavior; these fixtures need no renderer or artwork.
test.beforeEach(async ({ page }) => {
  await page.route('**/__bug-regressions', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><div id="app"></div>',
    }),
  );
  await page.goto('/__bug-regressions');
});

test('E collects the highlighted loot while its label has keyboard focus', async ({ page }) => {
  await page.evaluate(async () => {
    const moduleURL = '/src/adventure-ui.ts';
    const { bindAdventureUI } = await import(moduleURL);
    const root = document.querySelector('#app')!;
    root.innerHTML =
      '<canvas tabindex="0"></canvas><button class="ground-loot-label">Gold</button><button id="ordinary">Menu</button>';
    let interactions = 0;
    const app = {
      paused: false,
      busy: false,
      roomReady: true,
      canvas: root.querySelector('canvas'),
      interact: () => {
        interactions++;
        root.setAttribute('data-interactions', String(interactions));
      },
    };
    bindAdventureUI(app, root, new AbortController().signal);
  });
  await page.locator('.ground-loot-label').focus();
  await page.keyboard.press('e');
  await expect(page.locator('#app')).toHaveAttribute('data-interactions', '1');
  await page.locator('#ordinary').focus();
  await page.keyboard.press('e');
  await expect(page.locator('#app')).toHaveAttribute('data-interactions', '1');
});

test('leaving another focused loot label restores the stack still under the pointer', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const labelsURL = '/src/ground-loot-labels.ts',
      cameraURL = '/src/presentation/camera.ts';
    const sessionURL = '/src/core/session.ts',
      contentURL = '/tests/fixtures/content.ts';
    const { GroundLootLabels } = await import(labelsURL),
      { makeCamera } = await import(cameraURL);
    const { GameSession } = await import(sessionURL),
      { content } = await import(contentURL);
    const session = new GameSession(content);
    session.sim.drops = ['hovered', 'focused'].map((id) => ({
      id,
      source: 'test',
      enemy: false,
      x: 0,
      z: 0,
      rewards: [{ item: 'gold', amount: 1 }],
    }));
    const root = document.querySelector<HTMLElement>('#app')!;
    root.style.cssText = 'width:400px;height:400px';
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    document.body.append(canvas);
    const app = {
      sim: session.sim.view,
      presentation: { camera: makeCamera(1) },
      highlightedDrop: undefined as string | undefined,
    };
    const labels = new GroundLootLabels(root, app, new AbortController().signal);
    labels.update(true);
    const hovered = root.querySelector<HTMLButtonElement>('[data-drop="hovered"]')!;
    hovered.dispatchEvent(new PointerEvent('pointerenter'));
    root.querySelector<HTMLButtonElement>('[data-drop="focused"]')!.focus();
    const focused = app.highlightedDrop;
    canvas.focus();
    return { focused, afterBlur: app.highlightedDrop };
  });
  expect(result).toEqual({ focused: 'focused', afterBlur: 'hovered' });
});

test('closing the scene library retires its pending refresh', async ({ page }) => {
  const reopened = await page.evaluate(async () => {
    const libraryURL = '/src/editor/library.ts',
      uiURL = '/src/editor/ui.ts';
    const { SceneLibrary } = await import(libraryURL),
      { editorUI } = await import(uiURL);
    document.querySelector('#app')!.innerHTML = editorUI;
    const nativeFetch = window.fetch;
    const response = Promise.withResolvers<Response>();
    let count = 0;
    window.fetch = async () => (++count === 1 ? Response.json({ scenes: [] }) : response.promise);
    const library = new SceneLibrary({ recoveries: () => [] } as never);
    try {
      await library.load();
      const pending = library.load();
      const dialog = document.querySelector<HTMLDialogElement>('#scene-library-dialog')!;
      dialog.close();
      await new Promise<void>((resolve) =>
        dialog.addEventListener('close', () => resolve(), { once: true }),
      );
      response.resolve(Response.json({ scenes: [] }));
      await pending;
      return dialog.open;
    } finally {
      library.dispose();
      window.fetch = nativeFetch;
    }
  });
  expect(reopened).toBe(false);
});

async function profileProof(page: Page, mode: 'list' | 'restore') {
  return page.evaluate(async (mode) => {
    const groundURL = '/src/editor/ground-authoring.ts',
      uiURL = '/src/editor/ui.ts';
    const sceneURL = '/src/editor/default-scene.ts',
      manifestURL = '/tests/fixtures/manifest.ts';
    const fixtureURL = '/tests/fixtures/ground.ts';
    const { GroundAuthoring } = await import(groundURL),
      { editorUI } = await import(uiURL);
    const { emptyScene } = await import(sceneURL),
      { manifestFixture } = await import(manifestURL);
    const { groundFixture } = await import(fixtureURL);
    document.querySelector('#app')!.innerHTML = editorUI;
    let documentValue = emptyScene();
    documentValue.floor.layout = 'artwork';
    const manifest = manifestFixture(documentValue.floor.asset);
    manifest.asset.clips.surface = structuredClone(manifest.asset.clips.idle);
    const nativeFetch = window.fetch;
    const responses: ReturnType<typeof Promise.withResolvers<Response>>[] = [];
    window.fetch = () => {
      const response = Promise.withResolvers<Response>();
      responses.push(response);
      return response.promise;
    };
    const changes: string[] = [];
    const authoring = new GroundAuthoring(document.querySelector('#viewport')!, {
      document: () => documentValue,
      manifest: () => manifest,
      status: () => {},
      change: async (work: (d: typeof documentValue) => void) => {
        const draft = structuredClone(documentValue);
        work(draft);
        documentValue = draft;
        changes.push(draft.groundInteraction!.regions[0]!.name);
      },
    } as never);
    const controls = authoring as unknown as {
      loadProfiles(): Promise<void>;
      restoreProfile(): Promise<void>;
    };
    const profile = (name: string) => ({
      version: 1,
      name,
      floor: { width: documentValue.floor.width, depth: documentValue.floor.depth },
      interaction: groundFixture([{ id: 'region', name }], {
        asset: documentValue.floor.asset,
        frame: manifest.frames[0].id,
        hash: manifest.pages[0].hash,
        dimensions: manifest.asset.canvas,
      }),
    });
    try {
      if (mode === 'list') {
        const first = controls.loadProfiles(),
          latest = controls.loadProfiles();
        responses[1]!.resolve(
          Response.json({
            profiles: [{ id: 'new', name: 'New', hash: manifest.pages[0].hash, regions: 1 }],
          }),
        );
        await latest;
        responses[0]!.resolve(
          Response.json({
            profiles: [{ id: 'old', name: 'Old', hash: manifest.pages[0].hash, regions: 1 }],
          }),
        );
        await first;
        return {
          list: Array.from(
            document.querySelector<HTMLSelectElement>('#ground-profile')!.options,
          ).map((o) => o.value),
        };
      }
      const select = document.querySelector<HTMLSelectElement>('#ground-profile')!;
      select.replaceChildren(new Option('Old', 'old'), new Option('New', 'new'));
      select.value = 'old';
      const oldRestore = controls.restoreProfile();
      select.value = 'new';
      const newRestore = controls.restoreProfile();
      responses[0]!.resolve(Response.json({ profile: profile('Old') }));
      await oldRestore;
      responses[1]!.resolve(Response.json({ profile: profile('New') }));
      await newRestore;
      return { changes };
    } finally {
      authoring.dispose();
      window.fetch = nativeFetch;
    }
  }, mode);
}

test('late ground profile lists cannot replace a newer refresh', async ({ page }) => {
  expect(await profileProof(page, 'list')).toEqual({ list: ['', 'new'] });
});

test('an older ground profile restore cannot override the latest choice', async ({ page }) => {
  expect(await profileProof(page, 'restore')).toEqual({ changes: ['New'] });
});
