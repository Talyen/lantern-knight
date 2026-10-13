import { test, expect } from './fixtures';

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
  await page.goto('/editor.html?automated');
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
