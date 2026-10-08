import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { comparePixels } from './smoke-pixels';
import { smokeLaunch } from './smoke-launch';
import { visualEffectLabels, defaultVisualEffects } from '../src/content/visual-effects';
const run = await smokeLaunch(false),
  { page, errors, output } = run,
  changes: Record<string, number> = {};
try {
  await page.waitForFunction(
    () => document.querySelector('canvas')?.dataset.ready === 'true',
    {},
    { timeout: 60000 },
  );
  if (await page.locator('#modal').isVisible())
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  if (!(await page.locator('#modal').isVisible()))
    await page.getByRole('button', { name: 'Pause / save' }).click();
  await page.locator('#zoom-span').selectOption('15');
  for (const key of Object.keys(visualEffectLabels)) {
    const box = page.locator(`[data-visual-effect="${key}"]`);
    const { changed: count } = await comparePixels(page, () => box.uncheck(), {
      capture: run.capture
        ? [path.join(output, `${key}-on.png`), path.join(output, `${key}-off.png`)]
        : undefined,
    });
    changes[key] = count;
    if (key === 'rain')
      assert.equal(count, 0, 'dry scene must stay dry independently of the rain preference');
    else assert.ok(count > 10, `${key} must change its rendered contribution (${count})`);
    await box.check();
  }
  await page.locator('#zoom-span').selectOption('13');
  await page.locator('#render-scale').selectOption('0.75');
  await page.locator('[data-visual-effect="smoke"]').uncheck();
  await page.locator('[data-visual-effect="bloom"]').uncheck();
  const settingsFile = path.join(run.profile, 'saves/settings.json');
  await page.waitForFunction(async () => {
    const saved = await window.lantern!.loadSettings();
    return (
      (saved.status === 'ok' || saved.status === 'recovered') &&
      saved.data.visualEffects.bloom === false &&
      saved.data.verticalSpan === 13 &&
      saved.data.renderScale === 0.75
    );
  });
  const persisted = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
  assert.deepEqual((persisted as { visualEffects: unknown }).visualEffects, {
    ...defaultVisualEffects(),
    smoke: false,
    bloom: false,
  });
  assert.equal((persisted as { version: number }).version, 5);
  assert.equal((persisted as { depthOfField: number }).depthOfField, 1);
  await assert.rejects(fs.access(path.join(run.profile, 'saves/game.json')));
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('canvas')?.dataset.ready === 'true',
    {},
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: 'Pause / save' }).click();
  assert.equal(await page.locator('[data-visual-effect="smoke"]').isChecked(), false);
  assert.equal(await page.locator('[data-visual-effect="bloom"]').isChecked(), false);
  assert.equal(await page.locator('#zoom-span').inputValue(), '13');
  assert.equal(await page.locator('#render-scale').inputValue(), '0.75');
  assert.equal(
    await page.evaluate(() => 'foundation' in window || 'effectsPlayground' in window),
    false,
  );
  assert.deepEqual(errors, []);
  if (run.capture) await page.screenshot({ path: path.join(output, 'player-options.png') });
  await fs.rm(path.join(output, 'failure.json'), { force: true });
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        changes,
        checks: [
          'zoom, render quality and effect preferences survive reload',
          'dry weather independent of rain preference',
          'independent rendered effects',
          'settings persist without checkpoint',
          'reload restores preferences',
          'no experiment controls or inspection API',
        ],
        limitations: ['Hidden-window package smoke does not measure visible display pacing'],
      },
      null,
      2,
    ),
  );
  console.log('PASS: player visual options, persistence and dry-weather behavior');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ error: String(error), errors, changes }, null, 2),
  );
  throw error;
} finally {
  await run.close();
}
