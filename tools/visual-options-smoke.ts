import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { smokeLaunch } from './smoke-launch';
import { visualEffectLabels, defaultVisualEffects } from '../src/content/visual-effects';
const run = await smokeLaunch(false),
  { page, errors, output } = run,
  changes: Record<string, number> = {};
const capture = async () => {
  await page.waitForTimeout(80);
  return page.evaluate(
    () =>
      new Promise<string>((resolve) =>
        requestAnimationFrame(() => {
          const source = document.querySelector('canvas')!,
            copy = document.createElement('canvas');
          copy.width = source.width;
          copy.height = source.height;
          copy.getContext('2d')!.drawImage(source, 0, 0);
          resolve(copy.toDataURL('image/png').split(',')[1]!);
        }),
      ),
  );
};
const options = () => page.locator('[data-visual-effect]');
try {
  await page.waitForFunction(
    () => document.querySelector('canvas')?.dataset.ready === 'true',
    {},
    { timeout: 60000 },
  );
  if (await page.locator('#modal').isVisible())
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(1200);
  if (!(await page.locator('#modal').isVisible()))
    await page.getByRole('button', { name: 'Pause / save' }).click();
  assert.equal(await options().count(), 9);
  assert.equal(await page.locator('input[data-visual-effect]:checked').count(), 9);
  assert.equal(await page.locator('#zoom-span').inputValue(), '9');
  assert.equal(await page.locator('#depth-of-field').inputValue(), '100');
  await page.locator('#zoom-span').selectOption('15');
  for (const key of Object.keys(visualEffectLabels)) {
    const box = page.locator(`[data-visual-effect="${key}"]`),
      on = Buffer.from(await capture(), 'base64');
    await box.uncheck();
    const off = Buffer.from(await capture(), 'base64');
    if (run.capture) await fs.writeFile(path.join(output, `${key}-on.png`), on);
    if (run.capture) await fs.writeFile(path.join(output, `${key}-off.png`), off);
    const a = await sharp(on).raw().toBuffer(),
      b = await sharp(off).raw().toBuffer();
    let count = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 2) count++;
    changes[key] = count;
    if (key === 'rain')
      assert.equal(count, 0, 'dry scene must stay dry independently of the rain preference');
    else assert.ok(count > 10, `${key} must change its rendered contribution (${count})`);
    await box.check();
  }
  await page.locator('[data-visual-effect="smoke"]').uncheck();
  await page.locator('[data-visual-effect="bloom"]').uncheck();
  const settingsFile = path.join(run.profile, 'saves/settings.json');
  let persisted: unknown;
  for (let i = 0; i < 20; i++) {
    persisted = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    if ((persisted as { visualEffects: { bloom: boolean } }).visualEffects.bloom === false) break;
    await page.waitForTimeout(50);
  }
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
  assert.equal(await page.locator('#depth-of-field').inputValue(), '100');
  assert.equal(
    await page.evaluate(() => 'foundation' in window || 'effectsPlayground' in window),
    false,
  );
  assert.equal(await page.getByText('Outline appearance', { exact: true }).count(), 0);
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
          'nine default-on preferences',
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
