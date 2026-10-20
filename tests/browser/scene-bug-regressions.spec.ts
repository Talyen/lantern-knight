import { stateTest as test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { collectVisibleLoot } from '../../tools/smoke/collect-loot';
import { playerControls } from '../../tools/smoke/smoke-launch';

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

test('native diagnostic controls open collapsed journey actions before activating them', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const moduleURL = '/src/game-menu.ts';
    const { gameMenu } = await import(moduleURL);
    const root = document.querySelector('#app')!;
    root.innerHTML = gameMenu;
    const modal = root.querySelector<HTMLDialogElement>('#modal')!;
    const options = root.querySelector<HTMLDetailsElement>('#checkpoint-options')!;
    options.hidden = false;
    options.querySelector('div')!.append(root.querySelector('#new-game')!);
    for (const action of ['new-game', 'reset'])
      root.querySelector('#' + action)!.addEventListener('click', () => {
        root.setAttribute('data-action', action);
      });
    modal.showModal();
  });
  const controls = playerControls(page, 'unused');
  for (const action of ['new-game', 'reset'] as const) {
    await page.locator('#checkpoint-options').evaluate((element) => {
      (element as HTMLDetailsElement).open = false;
    });
    await controls.checkpoint(action);
    await expect(page.locator('#app')).toHaveAttribute('data-action', action);
    await expect(page.locator('#' + action)).toBeVisible();
  }
});

test('native journey collection completes when the final label retires during keyboard activation', async ({
  page,
}) => {
  await page.evaluate(() => {
    for (const id of ['first', 'last']) {
      const button = document.createElement('button');
      button.dataset.drop = id;
      button.setAttribute('aria-label', 'Collect ' + id);
      button.onclick = () => button.remove();
      document.body.append(button);
    }
  });
  expect(await collectVisibleLoot(page)).toBe(2);
  await expect(page.getByRole('button', { name: /^Collect / })).toHaveCount(0);
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
    const library = new SceneLibrary({} as never);
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

test('review flags remain editable after clearing orphaned scopes and reject an outdated backend', async ({
  page,
}) => {
  const reviewURL = '**/__lantern_editor?assetReview';
  const reviews = {
    version: 1,
    entries: [{ asset: 'retired-prop', scene: 'removed-scene', notes: 'Replace this' }],
  };
  await page.route(reviewURL, (route) =>
    route.fulfill({ json: { reviews, revision: 'initial', documents: [], warnings: [] } }),
  );
  await page.evaluate(async () => {
    const reviewURL = '/src/editor/asset-review.ts',
      uiURL = '/src/editor/ui.ts',
      sceneURL = '/src/editor/default-scene.ts';
    const { AssetReview } = await import(reviewURL),
      { editorUI } = await import(uiURL),
      { emptyScene } = await import(sceneURL);
    document.querySelector('#app')!.innerHTML = editorUI;
    const root = document.getElementById('review-panel')!;
    root.hidden = false;
    const review = new AssetReview(root, {
      document: emptyScene,
      manifests: new Map(),
      signal: new AbortController().signal,
      post: async (body: { reviews: unknown }) => ({ reviews: body.reviews, revision: 'saved' }),
      thumbnail: async () => {},
      open: async () => {},
      focus() {},
    });
    review.refresh();
  });
  await expect(page.locator('#review-feedback')).toContainText('Queue loaded');
  await page.locator('#review-view').selectOption('queue');
  await page.locator('#review-gallery button[data-asset="retired-prop"]').click();
  await expect(page.locator('#review-target')).toHaveValue('scene:removed-scene');
  await page.locator('#review-clear').click();
  await expect(page.locator('#review-feedback')).toHaveText('Replacement flag cleared.');
  await expect(page.locator('#review-target')).toHaveValue('everywhere');
  await expect(page.locator('#review-save')).toBeEnabled();
  await page.locator('#review-notes').fill('Keep this new note');
  await page.locator('#review-save').click();
  await expect(page.locator('#review-feedback')).toContainText('saved');
  await page.locator('#review-notes').fill('Keep this unsaved note');

  await page.unroute(reviewURL);
  await page.route(reviewURL, (route) => route.fulfill({ json: { scenes: [] } }));
  await page.locator('#review-reload').click();
  await expect(page.locator('#review-feedback')).toContainText('Restart the preview server');
  await expect(page.locator('#review-save')).toBeDisabled();
  await expect(page.locator('#review-clear')).toBeDisabled();
  await expect(page.locator('#review-notes')).toHaveValue('Keep this unsaved note');
  await page.unroute(reviewURL);
  await page.route(reviewURL, (route) =>
    route.fulfill({
      json: {
        reviews: { version: 1, entries: [] },
        revision: 'current',
        documents: [],
        warnings: [],
      },
    }),
  );
  await page.locator('#review-reload').click();
  await expect(page.locator('#review-feedback')).toContainText('Queue loaded');
  await expect(page.locator('#review-save')).toBeEnabled();
  await expect(page.locator('#review-notes')).toHaveValue('Keep this unsaved note');
});
