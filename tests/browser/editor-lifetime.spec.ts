import { test, expect, openEditor } from './fixtures';

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
