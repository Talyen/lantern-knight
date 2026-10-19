import { expect, type Page, type Locator } from '@playwright/test';
import type { SceneSnapshot } from '../../src/content/scene-document';

// Read the accepted document once per observation. A scoped browser handle keeps
// projections beside browser APIs without serializing whole scenes for each field.
export function readEditorDocument(page: Page): Promise<SceneSnapshot>;
export function readEditorDocument<T>(page: Page, read: (document: SceneSnapshot) => T): Promise<T>;
export async function readEditorDocument(
  page: Page,
  read: (document: SceneSnapshot) => unknown = (document) => document,
) {
  await using snapshot = await page.evaluateHandle(() => window.sceneEditor.state().document);
  return await snapshot.evaluate(read);
}
export function expectEditorDocument<T>(
  page: Page,
  read: (document: SceneSnapshot) => T,
  options?: Parameters<typeof expect.poll>[1],
) {
  return expect.poll(() => readEditorDocument(page, read), {
    timeout: 60_000,
    ...(typeof options === 'string' ? { message: options } : options),
  });
}

export async function importEditorScene(page: Page, document: unknown, name = 'scene.json') {
  await page.locator('#import-scene').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await page.locator('#confirmation-accept').click();
}

export async function changeField(field: Locator, value: string) {
  await field.fill(value);
  await field.dispatchEvent('change');
}
