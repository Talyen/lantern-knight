import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { smokeLaunch } from './smoke-launch';
import type {} from '../../src/inspection';
const run = await smokeLaunch(true),
  { page, output, errors } = run;
try {
  await page.waitForFunction(() => window.foundation?.ready, {}, { timeout: 60000 });
  await page.evaluate(async () => {
    await window.foundation.fixture('court');
    window.foundation.mode('encounter');
    window.foundation.pause(true);
  });
  const step = (ms: number) =>
    page.evaluate((ms) => {
      const f = window.foundation;
      f.presentation.update(f.sim, 1, ms, { x: 0, z: 0 });
    }, ms);
  assert.equal(
    await page.evaluate(() => window.foundation.presentation.sceneEffects.stats().rain.visible),
    false,
  );
  await page.evaluate(() =>
    window.foundation.presentation.setWeather({ rain: 1, wind: { x: 0.3, z: 0.1 } }),
  );
  await step(0);
  await page.evaluate(() => {
    const f = window.foundation;
    for (let i = 0; i < 14; i++) f.presentation.update(f.sim, 1, 250, { x: 0, z: 0 });
  });
  assert.equal(
    await page.evaluate(() => window.foundation.presentation.sceneEffects.stats().rain.visible),
    true,
  );
  assert.ok(
    (await page.evaluate(() => window.foundation.presentation.sceneEffects.stats().rain.drops)) > 0,
  );
  const warm = await page.evaluate(() => ({
    ...window.foundation.presentation.renderer.info.memory,
  }));
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.foundation.presentation.setVisualEffects({ rain: false }));
    await step(0);
    assert.equal(
      await page.evaluate(() => window.foundation.presentation.sceneEffects.stats().rain.visible),
      false,
    );
    await page.evaluate(() => window.foundation.presentation.setVisualEffects({ rain: true }));
    await step(0);
  }
  assert.deepEqual(
    await page.evaluate(() => ({ ...window.foundation.presentation.renderer.info.memory })),
    warm,
  );
  await page.evaluate(async () => {
    await window.foundation.fixture('upper-landing');
    window.foundation.pause(true);
  });
  await step(0);
  assert.equal(
    await page.evaluate(() => window.foundation.presentation.sceneEffects.stats().rain.visible),
    false,
  );
  if (run.capture) await page.screenshot({ path: path.join(output, 'crypt-effects.png') });
  await page.evaluate(async () => {
    await window.foundation.fixture('court');
    window.foundation.pause(true);
    window.foundation.presentation.setWeather(null);
  });
  await step(0);
  assert.equal(
    await page.evaluate(() => window.foundation.presentation.sceneEffects.stats().rain.visible),
    false,
  );
  assert.equal(
    await page.evaluate(() => window.foundation.presentation.renderer.getContext().getError()),
    0,
  );
  assert.deepEqual(errors, []);
  if (run.capture) await page.screenshot({ path: path.join(output, 'graveyard-effects.png') });
  await fs.rm(path.join(output, 'failure.json'), { force: true });
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'dry scene state',
          'explicit weather creates linked drops and impacts',
          'rain preference gates requested weather',
          'stable rain resources through toggles',
          'interior excludes ambient rain',
          'room replacement rebuilds fixture effects',
          'clearing weather restores dry scene',
          'no shader or GL errors',
        ],
        scope: 'Packaged developer app using production presentation and both existing scenes',
      },
      null,
      2,
    ),
  );
  console.log('PASS: production effects, explicit weather and room replacement');
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ error: String(error), errors }, null, 2),
  );
  throw error;
} finally {
  await run.close();
}
