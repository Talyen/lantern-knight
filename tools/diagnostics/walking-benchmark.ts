import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smokeLaunch, playerControls } from '../smoke/smoke-launch';
import { startGameBenchmark } from './game-benchmark';
import { frameSummary } from './benchmark-model';
import { content } from '../../src/content/game-content';

// Keep menu checks, loading-media proofs and checkpoint journeys in game-smoke.
export async function runWalkingBenchmark(flags: string[] = []) {
  if (flags.includes('--software') || flags.includes('--render-scale'))
    throw new Error('Walking baseline requires hardware rendering at render scale 1');
  const run = await smokeLaunch(
    false,
    process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : [],
    {
      flags: [...flags, '--visible'],
      retain: true,
      startupTimeoutMs: 16000,
      laneWaitMs: 0,
      budget: 32 * 1024 ** 2,
    },
  );
  const { page, app, errors } = run;
  const { pause, resume, save } = playerControls(page, run.profile);
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setContentSize(2560, 1440);
      window.show();
      window.focus();
    });
    await pause();
    await page.locator('#render-scale').selectOption('1');
    const initial = await save();
    assert.equal(initial.area, content.definitions.initialArea);
    await resume();
    await page.locator('canvas').focus();
    // Settle the resized renderer and first-use assets before timing movement.
    await page.waitForTimeout(1000);
    const measurement = await startGameBenchmark(run, initial, true);
    await measurement.phase('movement');
    await page.keyboard.down('KeyW');
    try {
      await page.waitForTimeout(5000);
      // Stop while movement is still held; save/menu work is outside the sample.
      await measurement.stop();
    } finally {
      await page.keyboard.up('KeyW');
    }
    const record = await measurement.finish();
    if (run.capture) await page.screenshot({ path: path.join(run.output, 'walking.png') });
    const final = await save();
    assert.equal(final.area, initial.area, 'Walking baseline must remain in its starting scene');
    assert.ok(
      Math.hypot(final.player.x - initial.player.x, final.player.z - initial.player.z) > 0.1,
      'Walking measurement must complete real player movement',
    );
    assert.equal(record.environment.visible, true);
    assert.ok(record.environment.refreshHz > 0, 'Display refresh rate is unavailable');
    assert.doesNotMatch(
      record.environment.gpu,
      /swiftshader|llvmpipe|software|unavailable/i,
      'Walking baseline requires an observed hardware GPU',
    );
    assert.equal(
      await page.evaluate(() => document.hasFocus() && document.visibilityState === 'visible'),
      true,
      'Walking baseline lost foreground focus',
    );
    assert.deepEqual(errors, []);
    await measurement.publish();
    const summary = frameSummary(record.frames);
    console.log(
      `Walking display: ${record.environment.refreshHz} Hz; framebuffer ${record.environment.buffer.join(' × ')}; GPU ${record.environment.gpu}`,
    );
    const pacing =
      summary.fps >= 59 &&
      summary.p95Ms <= 18 &&
      summary.p99Ms <= 20 &&
      summary.hitches === 0 &&
      summary.stalls === 0;
    console.log(
      record.environment.refreshHz >= 59 && record.environment.refreshHz <= 61
        ? `Provisional 60 Hz walking target: ${pacing ? 'met' : 'missed'}.`
        : '60 Hz target: inconclusive on this display refresh rate.',
    );
    console.log(
      'One five-second sample supports quick iteration, not absence of rare stutters or a performance improvement claim.',
    );
  } catch (error) {
    await fs.writeFile(
      path.join(run.output, 'failure.json'),
      JSON.stringify({ error: String(error), errors }),
    );
    throw error;
  } finally {
    await run.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runWalkingBenchmark(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
