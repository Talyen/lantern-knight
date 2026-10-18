import { writeJson } from '../json-file';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smokeLaunch, playerControls } from '../smoke/smoke-launch';
import { startGameBenchmark, requireGameBenchmarkPackage } from './game-benchmark';
import { frameSummary } from './benchmark-model';
import { content } from '../../src/content/game-content';
import { visualEffectLabels } from '../../src/content/visual-effects';

// Keep menu checks, loading-media proofs and checkpoint journeys in game-smoke.
async function runWalkingBenchmark(flags: string[] = []) {
  if (flags.includes('--software') || flags.includes('--render-scale'))
    throw new Error('Walking baseline requires hardware rendering at render scale 1');
  const visible = flags.includes('--visible');
  console.log(`Walking mode: ${visible ? 'visible fullscreen' : 'hidden'}.`);
  const run = await smokeLaunch(
    false,
    process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : [],
    {
      flags,
      retain: true,
      startupTimeoutMs: 16000,
      laneWaitMs: 0,
      budget: 32 * 1024 ** 2,
    },
  );
  const { page, app, errors } = run;
  const { pause, resume, save } = playerControls(page, run.profile);
  try {
    await requireGameBenchmarkPackage(run);
    await app.evaluate(({ BrowserWindow, screen }, visible) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      const display = screen.getDisplayMatching(window.getBounds());
      window.setContentSize(display.bounds.width, display.bounds.height);
      if (visible) {
        window.show();
        if (process.platform === 'darwin') window.setSimpleFullScreen(true);
        else window.setFullScreen(true);
        window.focus();
      }
    }, visible);
    // The title menu is already open. Starting a journey just to reopen the
    // menu can race its asynchronous first-room admission.
    if (!(await page.locator('#modal').isVisible())) await pause();
    await page.locator('#menu-settings').click();
    await page.locator('#render-scale').selectOption('1');
    await page.locator('#depth-of-field').fill('100');
    await page.locator('#depth-of-field').dispatchEvent('input');
    await page.locator('.advanced-settings > summary').click();
    const effects = page.locator('#modal input[data-visual-effect]');
    for (const effect of await effects.all()) await effect.setChecked(true);
    await page.locator('#menu-back').click();
    await resume();
    const initial = await save();
    assert.equal(initial.area, content.definitions.initialArea);
    await resume();
    await page.locator('canvas').focus();
    // Settle the resized renderer and first-use assets before timing movement.
    await page.waitForTimeout(1000);
    const measurement = await startGameBenchmark(run, initial, true);
    await measurement.phase('movement');
    console.log(`Walking sample: five seconds (${visible ? 'visible fullscreen' : 'hidden'}).`);
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
    assert.equal(record.environment.visible, visible);
    assert.equal(record.environment.settings['render-scale'], '1');
    assert.equal(record.environment.settings['depth-of-field'], '100');
    for (const effect of Object.keys(visualEffectLabels))
      assert.equal(record.environment.settings[effect], true, `${effect} must be enabled`);
    if (visible)
      assert.equal(
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!;
          return window.isFullScreen() || window.isSimpleFullScreen();
        }),
        true,
        'Visible confirmation must be fullscreen',
      );
    assert.ok(record.environment.refreshHz > 0, 'Display refresh rate is unavailable');
    assert.doesNotMatch(
      record.environment.gpu,
      /swiftshader|llvmpipe|software|unavailable/i,
      'Walking baseline requires an observed hardware GPU',
    );
    if (visible)
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
    if (!visible) console.log('Hidden renderer sample: confirm the 60 Hz target with --visible.');
    else
      console.log(
        record.environment.refreshHz >= 59 && record.environment.refreshHz <= 61
          ? `Provisional 60 Hz walking target: ${pacing ? 'met' : 'missed'}.`
          : '60 Hz target: inconclusive on this display refresh rate.',
      );
    console.log(
      'One five-second sample supports quick iteration, not absence of rare stutters or a performance improvement claim.',
    );
  } catch (error) {
    await page.screenshot({ path: path.join(run.output, 'failure.png') }).catch(() => {});
    const ui = await page
      .evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(0, 4000),
        focused: document.activeElement?.id,
      }))
      .catch(() => undefined);
    await writeJson(path.join(run.output, 'failure.json'), { error: String(error), errors, ui });
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
