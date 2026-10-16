import { test, expect } from './fixtures';

// These DOM lifetimes need real focus, dialog and media events, but no artwork or GPU setup.
test.beforeEach(async ({ page }) => {
  await page.route('**/__ui-regressions', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="app"></div>' }),
  );
  await page.goto('/__ui-regressions');
});

test('loot hover remains selected when keyboard focus leaves its label', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const labelURL = '/src/ground-loot-labels.ts';
    const cameraURL = '/src/presentation/camera.ts';
    const sessionURL = '/src/core/session.ts';
    const fixtureURL = '/tests/fixtures/content.ts';
    const { GroundLootLabels } = (await import(
      labelURL
    )) as typeof import('../../src/ground-loot-labels');
    const { makeCamera } = (await import(
      cameraURL
    )) as typeof import('../../src/presentation/camera');
    const { GameSession } = (await import(sessionURL)) as typeof import('../../src/core/session');
    const { content } = (await import(fixtureURL)) as typeof import('../fixtures/content');
    const session = new GameSession(content);
    session.sim.drops.push({
      id: 'item',
      source: 'test',
      enemy: false,
      x: 0,
      z: 0,
      rewards: [{ item: 'gold', amount: 1 }],
    });
    const root = document.createElement('div');
    root.style.cssText = 'width:400px;height:400px';
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    document.body.append(root, canvas);
    const app = {
      sim: session.sim.view,
      presentation: { camera: makeCamera(1) },
      highlightedDrop: undefined as string | undefined,
    };
    const lifetime = new AbortController();
    const labels = new GroundLootLabels(
      root,
      app as unknown as import('../../src/application').Application,
      lifetime.signal,
    );
    labels.update(true);
    const label = root.querySelector('button')!;
    label.focus();
    const focused = app.highlightedDrop;
    canvas.focus();
    const blurred = app.highlightedDrop;
    label.dispatchEvent(new PointerEvent('pointerenter'));
    label.focus();
    canvas.focus();
    const hovered = app.highlightedDrop;
    label.dispatchEvent(new PointerEvent('pointerleave'));
    const left = app.highlightedDrop;
    lifetime.abort();
    return { focused, blurred: blurred ?? null, hovered, left: left ?? null };
  });
  expect(result).toEqual({ focused: 'item', blurred: null, hovered: 'item', left: null });
});

test('closing a source media preview pauses its playback', async ({ page }) => {
  const pauses = await page.evaluate(async () => {
    const moduleURL = '/src/editor/library-inventory.ts';
    const { libraryInventory } = (await import(
      moduleURL
    )) as typeof import('../../src/editor/library-inventory');
    const nativeFetch = window.fetch;
    const lifetime = new AbortController();
    const host = document.querySelector<HTMLElement>('#app')!;
    const file = `generated/library/media/${'a'.repeat(64)}.wav`;
    window.fetch = async () =>
      Response.json({
        files: [],
        images: [],
        media: [{ path: 'Sound.wav', file, sha256: 'a'.repeat(64), bytes: 1 }],
        unresolvedAnimations: [],
      });
    try {
      await libraryInventory(host, lifetime.signal, () => {});
      const details = host.querySelector('details')!;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      const audio = host.querySelector('audio')!;
      let pauses = 0;
      audio.pause = () => {
        pauses++;
      };
      audio.load = () => {};
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
      return pauses;
    } finally {
      lifetime.abort();
      window.fetch = nativeFetch;
    }
  });
  expect(pauses).toBe(1);
});

test('cancelled source inventory loading cannot mount into a later editor', async ({ page }) => {
  const children = await page.evaluate(async () => {
    const moduleURL = '/src/editor/library-inventory.ts';
    const { libraryInventory } = (await import(
      moduleURL
    )) as typeof import('../../src/editor/library-inventory');
    const nativeFetch = window.fetch;
    const lifetime = new AbortController();
    const host = document.querySelector<HTMLElement>('#app')!;
    const data = Promise.withResolvers<unknown>();
    const reading = Promise.withResolvers<void>();
    window.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: () => {
          reading.resolve();
          return data.promise;
        },
      }) as Response;
    try {
      const pending = libraryInventory(host, lifetime.signal, () => {}).catch(() => {});
      await reading.promise;
      lifetime.abort();
      data.resolve({ files: [], images: [], media: [], unresolvedAnimations: [] });
      await pending;
      return host.children.length;
    } finally {
      lifetime.abort();
      window.fetch = nativeFetch;
    }
  });
  expect(children).toBe(0);
});

test('disposed editor confirmations decline later requests without reopening a dialog', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const moduleURL = '/src/editor/confirmation.ts';
    const { EditorConfirmation } = (await import(
      moduleURL
    )) as typeof import('../../src/editor/confirmation');
    document.querySelector('#app')!.innerHTML =
      '<dialog id="editor-confirmation"><p id="confirmation-message"></p><button id="confirmation-accept"></button></dialog>';
    const confirmation = new EditorConfirmation();
    const pending = confirmation.ask('Replace this scene?', 'Replace');
    confirmation.dispose();
    const cancelled = await pending;
    try {
      return { cancelled, late: await confirmation.ask('Late file import', 'Replace') };
    } catch {
      return { cancelled, late: 'rejected' };
    }
  });
  expect(result).toEqual({ cancelled: false, late: false });
});
