import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { comparePixels } from './smoke-pixels';
import { smokeLaunch } from './smoke-launch';
import { effectLabels, type PlaygroundEffect } from '../../src/content/effects-playground';
import type {} from '../../src/sandbox/effects';

export async function runScenario(flags: string[] = []) {
  const run = await smokeLaunch(true, ['--effects'], { flags }),
    { page, output, errors } = run,
    changes: Record<string, number> = {};
  try {
    await page.waitForFunction(() => window.effectsPlayground?.ready, {}, { timeout: 60000 });
    await page.evaluate(() => window.effectsPlayground.pause(true));
    await page.evaluate(() => window.effectsPlayground.setTreatment('rich'));
    await page.evaluate(() => window.effectsPlayground.step(630));
    for (const key of Object.keys(effectLabels) as PlaygroundEffect[]) {
      await page.evaluate((key) => window.effectsPlayground.setEffect(key, true), key);
      const { changed: count } = await comparePixels(
        page,
        () => page.evaluate((key) => window.effectsPlayground.setEffect(key, false), key),
        {
          effects: true,
          capture: run.capture
            ? [path.join(output, `${key}-on.png`), path.join(output, `${key}-off.png`)]
            : undefined,
        },
      );
      assert.ok(count > 30, `${key} should visibly change: ${count} channels`);
      changes[key] = count;
      await page.evaluate((key) => window.effectsPlayground.setEffect(key, true), key);
    }
    await page.getByRole('button', { name: 'Visuals', exact: true }).click();
    await page.getByText('Individual effects', { exact: true }).click();
    const selection = await page.evaluate(() => window.effectsPlayground.settings.effects);
    await page.locator('#baseline').check();
    const baseline = await comparePixels(
      page,
      async () => {
        await page.locator('#baseline').uncheck();
        await page.evaluate(() => window.effectsPlayground.render());
        await page.locator('#baseline').check();
      },
      { effects: true, tolerance: 0 },
    );
    assert.equal(baseline.maxDifference, 0, 'Baseline must restore every pixel');
    assert.deepEqual(
      await page.evaluate(() => window.effectsPlayground.settings.effects),
      selection,
    );
    await page.locator('#baseline').uncheck();
    const before = await page.evaluate(() => window.effectsPlayground.stats().time);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.effectsPlayground.stats().time), before);
    await page.evaluate(() => window.effectsPlayground.step(400));
    assert.ok((await page.evaluate(() => window.effectsPlayground.stats().time)) > before);
    const counts = await page.evaluate(() => window.effectsPlayground.stats().objects);
    for (let i = 0; i < 3; i++) {
      await page.locator('#all-off').click();
      await page.evaluate(() => window.effectsPlayground.render());
      await page.locator('#all-on').click();
      await page.locator('#reset').click();
      await page.evaluate(() => window.effectsPlayground.render());
    }
    assert.deepEqual(await page.evaluate(() => window.effectsPlayground.stats().objects), counts);
    assert.deepEqual(errors, []);
    await run.reportWork();
    await page.locator('#scene-select').selectOption('outdoor-fixture');
    await page.waitForFunction(() => window.foundation?.ready);
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          passed: true,
          changes,
          checks: [
            'independent developer scene',
            'all effect toggles change rendered pixels',
            'baseline restores exact pixels without changing selection',
            'pause and frame-step',
            'stable resources through replay/toggles',
            'return to Dev Preview scene',
          ],
          scope:
            'Packaged macOS developer app; source art and the two production scene definitions are unchanged by this work.',
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${Object.keys(changes).length} visual effect comparisons and isolated lab routing`,
    );
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
}
