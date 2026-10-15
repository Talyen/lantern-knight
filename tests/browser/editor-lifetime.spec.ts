import { expectPageValue, test, expect, openEditor } from './fixtures';

// Failure happens after the workspace, renderer and authoring tools have mounted.
// A failed startup must close their observers just like leaving a ready editor.
test('failed editor startup closes the complete mounted session', async ({ page, errors }) => {
  await page.addInitScript(() => {
    const observers = new Set<IntersectionObserver>();
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(...args: ConstructorParameters<typeof IntersectionObserver>) {
        super(...args);
        observers.add(this);
      }
      override disconnect() {
        observers.delete(this);
        super.disconnect();
      }
    };
    Object.assign(window, { editorObserverCount: () => observers.size });
  });
  await page.route('**/generated/library/index.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: '{' }),
  );
  // Startup can still be fetching assets when navigation finishes. Wait for
  // the injected failure before asserting that its cleanup has completed.
  const failedIndex = page.waitForResponse('**/generated/library/index.json', { timeout: 60_000 });
  await page.goto('/editor.html?automated');
  await failedIndex;
  await expect(page.locator('#status')).toContainText('Editor startup failed:');
  expect(await page.evaluate(() => window.sceneEditor.ready())).toBe(false);
  expect(
    await page.evaluate(() =>
      (window as unknown as { editorObserverCount: () => number }).editorObserverCount(),
    ),
  ).toBe(0);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('#command-dialog')).not.toBeVisible();
  await page.evaluate(() => window.sceneEditor.dispose());
  expect(errors).toEqual([]);
});

test('editor shutdown drains renderer and runtime ownership after a renderer exception', async ({
  page,
}) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const moduleURL = '/src/editor/playtest.ts';
    const { DraftPlaytest } = (await import(
      moduleURL
    )) as typeof import('../../src/editor/playtest');
    const playtest = new DraftPlaytest({
      document: () => window.sceneEditor.state().document,
      compose: () => {
        throw new Error('unused composition');
      },
      catalog: () => ({}),
      manifest: () => undefined,
      status: () => {},
    });
    let overlayCalls = 0,
      appCalls = 0;
    Object.assign(playtest, {
      overlay: {
        dispose: () => {
          overlayCalls++;
          throw new Error('injected overlay shutdown');
        },
      },
      app: {
        dispose: () => {
          appCalls++;
        },
      },
    });
    let previewError = '';
    try {
      playtest.dispose();
    } catch (failure) {
      previewError = String(failure);
    }
    playtest.dispose();
    const previewRemoved = !Reflect.get(playtest, 'dialog').isConnected;
    const editor = window.sceneEditor,
      view = editor.view(),
      runtime = view.runtime;
    const presentation = view.presentation!;
    const original = presentation.dispose.bind(presentation);
    let calls = 0;
    presentation.dispose = () => {
      calls++;
      original();
      throw new Error('injected renderer shutdown');
    };
    let error = '';
    try {
      editor.dispose();
    } catch (failure) {
      error = String(failure);
    }
    editor.dispose();
    let closed = false;
    try {
      runtime.seedManifest('unused', {});
    } catch {
      closed = true;
    }
    return {
      error,
      closed,
      resources: runtime.resourceCount,
      ready: editor.ready(),
      calls,
      previewError,
      previewRemoved,
      overlayCalls,
      appCalls,
    };
  });
  expect(result.previewError).toContain('injected overlay shutdown');
  expect(result.previewRemoved).toBe(true);
  expect(result.overlayCalls).toBe(1);
  expect(result.appCalls).toBe(1);
  expect(result.error).toContain('injected renderer shutdown');
  expect(result.closed).toBe(true);
  expect(result.resources).toBe(0);
  expect(result.ready).toBe(false);
  expect(result.calls).toBe(1);
});

test('closing a stalled playtest releases startup admission without late error feedback', async ({
  page,
}) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const moduleURL = '/src/assets/loader.ts';
    const { AssetRuntime } = (await import(moduleURL)) as typeof import('../../src/assets/loader');
    const original = AssetRuntime.open.bind(AssetRuntime);
    const pending: ReturnType<typeof Promise.withResolvers<InstanceType<typeof AssetRuntime>>>[] =
      [];
    AssetRuntime.open = () => {
      const opening = Promise.withResolvers<InstanceType<typeof AssetRuntime>>();
      pending.push(opening);
      return opening.promise;
    };
    Object.assign(window, {
      playtestOpeningCount: () => pending.length,
      restorePlaytestOpening: () => {
        AssetRuntime.open = original;
        for (const opening of pending) opening.reject(new Error('late cancelled catalog'));
      },
    });
  });
  try {
    for (let count = 1; count <= 2; count++) {
      await page.locator('#play-from-here').click();
      await expectPageValue(page, () =>
        (window as unknown as { playtestOpeningCount: () => number }).playtestOpeningCount(),
      ).toBe(count);
      await expect(page.locator('#playtest-dialog')).toBeVisible();
      await page.locator('#playtest-return').click();
      await expect(page.locator('#playtest-dialog')).not.toBeVisible();
      expect(await page.evaluate(() => window.sceneEditor.playtest())).toBeUndefined();
      await expect(page.locator('#validation-errors')).toHaveText('');
    }
  } finally {
    await page.evaluate(() =>
      (window as unknown as { restorePlaytestOpening: () => void }).restorePlaytestOpening(),
    );
  }
  await expect(page.locator('#validation-errors')).toHaveText('');
});

test('art preview leases end on dialog close and editor shutdown', async ({ page, errors }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const moduleURL = '/src/editor/preview-images.ts';
    const { PreviewImages } = (await import(
      moduleURL
    )) as typeof import('../../src/editor/preview-images');
    const owners = new Set<InstanceType<typeof PreviewImages>>();
    const original: typeof PreviewImages.prototype.playback = Reflect.get(
      PreviewImages.prototype,
      'playback',
    );
    PreviewImages.prototype.playback = function (target) {
      owners.add(this);
      return original.call(this, target);
    };
    Object.assign(window, {
      activePreviewLeases: () =>
        [...owners].reduce((sum, owner) => sum + Reflect.get(owner, 'playbacks').size, 0),
    });
  });
  const leaseCount = () =>
    page.evaluate(() =>
      (window as unknown as { activePreviewLeases: () => number }).activePreviewLeases(),
    );
  await page.locator('#artwork-tab').click();
  await page.locator('#search').fill('ink-scenery');
  await page.getByTitle('ink-scenery/arch', { exact: true }).click();
  await expect.poll(leaseCount).toBe(0);
  const dialog = page.locator('#art-preview');
  await page.locator('#preview-asset').click();
  await expect(dialog).toBeVisible();
  await expect.poll(leaseCount).toBe(1);
  await expect
    .poll(
      () =>
        page.locator('#art-preview-canvas').evaluate((target: HTMLCanvasElement) => {
          const pixels = target
            .getContext('2d')!
            .getImageData(0, 0, target.width, target.height).data;
          return pixels.some((value, index) => index % 4 === 3 && value > 0);
        }),
      // Full-size authoring pages can require a cold delivery download.
      { timeout: 60_000 },
    )
    .toBe(true);
  await page.locator('#preview-play').click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(leaseCount).toBe(0);
  await page.locator('#preview-asset').click();
  await expect.poll(leaseCount).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect.poll(leaseCount).toBe(0);
  await page.locator('#preview-asset').click();
  await expect.poll(leaseCount).toBe(1);
  await page.evaluate(() => window.sceneEditor.dispose());
  expect(await leaseCount()).toBe(0);
  expect(errors).toEqual([]);
});

test('a frame fault closes editor ownership and leaves visible failure feedback', async ({
  page,
  errors,
}) => {
  await openEditor(page);
  await page.evaluate(() => {
    const view = window.sceneEditor.view();
    Object.assign(window, { failedFrameRuntime: view.runtime });
    view.render = () => {
      throw new Error('injected frame failure');
    };
  });
  await expect(page.locator('#status')).toContainText('Editor stopped: injected frame failure');
  expect(
    await page.evaluate(() => {
      const runtime = (
        window as unknown as { failedFrameRuntime: import('../../src/assets/loader').AssetRuntime }
      ).failedFrameRuntime;
      let closed = false;
      try {
        runtime.seedManifest('unused', {});
      } catch {
        closed = true;
      }
      return { ready: window.sceneEditor.ready(), closed, resources: runtime.resourceCount };
    }),
  ).toEqual({ ready: false, closed: true, resources: 0 });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('#command-dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('editor remount closes its predecessor and shutdown revokes retained DOM controls', async ({
  page,
  errors,
}) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const old = window.sceneEditor,
      runtime = old.view().runtime;
    const moduleURL = '/src/editor/session.ts';
    const { createEditorSession } = (await import(
      moduleURL
    )) as typeof import('../../src/editor/session');
    const presentation = old.view().presentation!,
      disposePresentation = presentation.dispose.bind(presentation);
    let successor: ReturnType<typeof createEditorSession> | undefined;
    presentation.dispose = () => {
      disposePresentation();
      successor = createEditorSession();
    };
    const next = createEditorSession();
    if (next !== successor) throw new Error('Returning remount replaced its reentrant successor');
    let closed = false;
    try {
      runtime.seedManifest('unused', {});
    } catch {
      closed = true;
    }
    if (!closed || old.ready()) throw new Error('Remount retained the old editor resource graph');
    old.dispose();
    if (window.sceneEditor !== next) throw new Error('Old shutdown changed successor inspection');
  });
  await expectPageValue(page, () => window.sceneEditor.ready(), { timeout: 60_000 }).toBe(true);
  const result = await page.evaluate(() => {
    const commands = document.getElementById('commands') as HTMLButtonElement;
    const focus = document.getElementById('focus-mode') as HTMLButtonElement;
    window.sceneEditor.dispose();
    commands.click();
    focus.click();
    return {
      modal: (document.getElementById('command-dialog') as HTMLDialogElement).open,
      focused: document.body.classList.contains('focus-mode'),
      inert: document.getElementById('app')!.inert,
    };
  });
  expect(result).toEqual({ modal: false, focused: false, inert: true });
  expect(errors).toEqual([]);
});

test('library rendering ignores superseded listings and cancelled arrangement bodies', async ({
  page,
}) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const moduleURL = '/src/editor/library.ts';
    const { SceneLibrary } = (await import(moduleURL)) as typeof import('../../src/editor/library');
    const requests: ReturnType<typeof Promise.withResolvers<Response>>[] = [];
    const requestedBody = Promise.withResolvers<void>();
    const original = window.fetch;
    window.fetch = () => {
      const request = Promise.withResolvers<Response>();
      requests.push(request);
      if (requests.length === 4) requestedBody.resolve();
      return request.promise;
    };
    const library = Object.create(SceneLibrary.prototype) as InstanceType<typeof SceneLibrary>;
    const fragments = document.getElementById('library-fragments')!;
    Object.assign(library, {
      lifetime: new AbortController(),
      loadSequence: 0,
      dialog: document.getElementById('scene-library-dialog'),
      preview: window.sceneEditor.view().presentation!.overlay.clone(false),
      host: {
        recoveries: () => [{ name: '<recovery>', time: 'now', key: 'recovery' }],
        view: () => ({ render() {} }),
      },
    });
    try {
      const first = library.load(),
        second = library.load('recovery');
      requests[1]!.resolve(Response.json({ scenes: [] }));
      await second;
      requests[0]!.resolve(
        Response.json({ scenes: [{ id: 'old', name: 'Old listing', target: 'draft' }] }),
      );
      await first;
      const title = document.getElementById('library-title')!.textContent;
      const recovery = document.getElementById('library-recovery')!.textContent;
      const body = Promise.withResolvers<unknown>();
      const loading = library.load('arrangements').then(
        () => 'accepted',
        () => 'cancelled',
      );
      requests[2]!.resolve(Response.json({ scenes: [] }));
      await requestedBody.promise;
      requests[3]!.resolve(Object.assign(Response.json(null), { json: () => body.promise }));
      await Promise.resolve();
      library.dispose();
      body.resolve({ fragments: [{ id: 'late', error: 'Late arrangement' }] });
      return { title, recovery, outcome: await loading, fragments: fragments.children.length };
    } finally {
      window.fetch = original;
      library.dispose();
    }
  });
  expect(result).toEqual({
    title: 'Recovery history',
    recovery: '<recovery> · now',
    outcome: 'cancelled',
    fragments: 0,
  });
});
