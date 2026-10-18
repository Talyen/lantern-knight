import { test, expect, openEditor, waitForEditor, waitForEditorIdle } from './fixtures';
import { importEditorScene, readEditorDocument } from './editor-driver';
import { sceneFixture } from '../fixtures/scene';
import { projectRoot } from '../../tools/assets/paths';
import fs from 'node:fs/promises';
import path from 'node:path';

test('asset review focuses scene uses and persists scoped notes with conflict recovery', async ({
  page,
  request,
  errors,
}) => {
  const file = path.join(projectRoot, 'authoring/asset-reviews.json');
  const original = await fs.readFile(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  const savedSceneId = 'review-disk-' + Date.now();
  const sceneFile = path.join(projectRoot, 'authoring/scenes', savedSceneId + '.json');
  const fixture = sceneFixture('graveyard');
  fixture.id = 'review-current-' + Date.now();
  fixture.name = 'Review fixture';
  fixture.objects = fixture.objects.slice(0, 1);
  fixture.objects.push({ ...fixture.objects[0]!, id: 'second-tomb', x: 3, z: 3 });
  const currentSceneFile = path.join(projectRoot, 'authoring/scenes', fixture.id + '.json');
  try {
    await fs.writeFile(file, JSON.stringify({ version: 1, entries: [] }));
    await fs.writeFile(
      sceneFile,
      JSON.stringify({ ...fixture, id: savedSceneId, name: 'Saved review fixture' }),
    );
    await openEditor(page);
    await importEditorScene(page, fixture);
    await waitForEditorIdle(page);
    await page.locator('#save').click();
    await page.locator('#file-id').fill(fixture.id);
    await page.locator('#confirm-save').click();
    await expect(page.locator('#save-state')).toHaveText('Saved', { timeout: 30000 });
    const before = await readEditorDocument(page);
    await page.locator('#review-tab').click();
    await expect(page.locator('#review-feedback')).toContainText('Queue loaded', {
      timeout: 30000,
    });
    await page.locator('#review-search').fill('ink-scenery');
    await expect(page.locator('#review-gallery button')).toHaveCount(1);
    await page.locator('#review-gallery button').click();
    await expect(page.locator('#review-usages')).toContainText('2 placements');
    await expect(page.locator('#review-clip')).toHaveValue('tomb');
    await page
      .locator('#review-usages button')
      .filter({ hasText: /^Imported Review fixture/ })
      .click();
    await expect(page.locator('#review-tab')).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => window.sceneEditor.state().selected)).toBe('second-tomb');
    await page.locator('#review-notes').fill('Too ornate; use a plain stone instead.');
    await page.locator('#review-save').click();
    await expect(page.locator('#review-feedback')).toHaveText(
      'Replacement flag saved to the shared queue.',
    );
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.entries).toEqual([
      { asset: 'ink-scenery', scene: fixture.id, notes: 'Too ornate; use a plain stone instead.' },
    ]);
    expect(await readEditorDocument(page)).toEqual(before);

    await page.locator('#review-target').selectOption('everywhere');
    await page.locator('#review-notes').fill('Retire the whole set.');
    await page.locator('#review-save').click();
    await expect(page.locator('#review-feedback')).toContainText('saved');
    await page.locator('#name').fill(before.name + ' draft');
    await page.locator('#name').dispatchEvent('change');
    await waitForEditorIdle(page);
    await page.reload();
    await waitForEditor(page);
    // Restore the imported scene from the existing document recovery.
    if (await page.locator('#restore').isVisible()) await page.locator('#restore').click();
    await waitForEditorIdle(page);
    await page.locator('#review-tab').click();
    await expect(page.locator('#review-feedback')).toContainText('Queue loaded', {
      timeout: 30000,
    });
    await page.locator('#review-view').selectOption('queue');
    await expect(page.locator('#review-gallery button')).toHaveCount(1);
    await page.locator('#review-gallery button').click();
    await page.locator('#review-target').selectOption('everywhere');
    await expect(page.locator('#review-notes')).toHaveValue('Retire the whole set.');
    await expect(page.locator('#review-flags')).toContainText(`Replace in ${before.name}`);
    await expect(page.locator('#review-flags')).toContainText('Retire everywhere');

    // Another editor changes the file while this one holds an earlier revision.
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    current.entries.push({ asset: 'ink-moss', scene: null, notes: 'External review' });
    await fs.writeFile(file, JSON.stringify(current));
    await page.locator('#review-notes').fill('Preserve my revised notes.');
    await page.locator('#review-save').click();
    await expect(page.locator('#review-feedback')).toContainText('changed on disk');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(current);
    const conflict =
      'Failed to load resource: the server responded with a status of 409 (Conflict)';
    await expect.poll(() => errors.includes(conflict)).toBe(true);
    errors.splice(errors.indexOf(conflict), 1);
    await page.locator('#review-reload').click();
    await expect(page.locator('#review-feedback')).toContainText('Queue loaded', {
      timeout: 30000,
    });
    await expect(page.locator('#review-notes')).toHaveValue('Preserve my revised notes.');
    await page.locator('#review-save').click();
    await expect(page.locator('#review-feedback')).toContainText('saved');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).entries).toContainEqual(current.entries[2]);

    await page.locator('#review-view').selectOption('all');
    await page.locator('#review-search').fill('');
    await expect(page.locator('#review-count')).not.toHaveText('0 assets · 0 scenes');
    // The queue is served by the protected project endpoint, not browser preferences.
    const denied = await request.post('/__lantern_editor', { data: { action: 'assetReview' } });
    expect(denied.status()).toBe(403);
    await page.setViewportSize({ width: 600, height: 850 });
    await expect(page.locator('#review-reload')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#review-view').selectOption('queue');
    await page.locator('#review-gallery button[data-asset="ink-scenery"]').click();
    await page.locator('#review-target').selectOption('everywhere');
    await page.locator('#review-clear').click();
    await expect(page.locator('#review-feedback')).toHaveText('Replacement flag cleared.');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).entries).toContainEqual(saved.entries[0]);
    await page.locator('#review-usages button').filter({ hasText: 'Saved review fixture' }).click();
    await expect(page.getByRole('dialog', { name: 'Confirm action' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await readEditorDocument(page)).id).toBe(fixture.id);
    await page.locator('#review-usages button').filter({ hasText: 'Saved review fixture' }).click();
    await page.getByRole('button', { name: 'Discard edits', exact: true }).click();
    await waitForEditorIdle(page);
    await expect(page.locator('#name')).toHaveValue('Saved review fixture');
    expect(await page.evaluate(() => window.sceneEditor.state().selected)).toBe('second-tomb');
    await page.screenshot({ path: '/tmp/lantern-asset-review.png' });
  } finally {
    await fs.rm(sceneFile, { force: true });
    await fs.rm(currentSceneFile, { force: true });
    if (original) await fs.writeFile(file, original);
    else await fs.rm(file, { force: true });
  }
});
