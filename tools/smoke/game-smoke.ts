import { checkLoadingScreen } from './loading-screen';
import { startGameBenchmark } from '../diagnostics/game-benchmark';
import { option, smokeLaunch, playerControls } from './smoke-launch';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runScenario(flags: string[] = []) {
  const benchmark = flags.includes('--benchmark');
  const run = await smokeLaunch(
      false,
      flags.includes('--software') ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
      { flags, retain: benchmark },
    ),
    { app, page, output, errors } = run;
  const checks: string[] = [];
  let stage = 'startup-checks';
  const journeyStarted = performance.now();
  const markStage = async (name: string) => {
    stage = name;
    const elapsedMs = Math.round(performance.now() - journeyStarted);
    console.log(`Game journey: ${stage} (${elapsedMs}ms)`);
    await fs.writeFile(
      path.join(output, 'progress.json'),
      JSON.stringify({ stage, elapsedMs, checks }),
    );
  };
  try {
    await checkLoadingScreen(run, false);
    await markStage(stage);
    await page.waitForFunction(
      () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
      {},
      { timeout: 45000 },
    );
    const renderer = await page.evaluate(() => {
      const gl = document.querySelector('canvas')!.getContext('webgl2')!,
        info = gl.getExtension('WEBGL_debug_renderer_info');
      return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
    });
    console.log('Game renderer: ' + renderer);
    await app.evaluate(({ BrowserWindow }, benchmark) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(
        benchmark ? 2560 : 1280,
        benchmark ? 1440 : 800,
      );
    }, benchmark);
    assert.equal(await page.evaluate(() => 'foundation' in window), false);
    assert.equal(await page.evaluate(() => typeof window.lantern?.launchMode), 'undefined');
    checks.push('player package exposes no inspection API or developer launch bridge');
    const capture = async (name: string) => {
      if (run.capture) await page.screenshot({ path: path.join(output, `${name}.png`) });
    };
    const {
      pause,
      resume,
      save: observe,
      frames: renderedFrames,
    } = playerControls(page, run.profile);
    // Interaction checks use the player's existing quality setting on software-rendered CI.
    if (!(await page.locator('#modal').isVisible()))
      await page.getByRole('button', { name: 'Pause / save' }).click();
    await page
      .locator('#render-scale')
      .selectOption(benchmark ? option('--render-scale', '1', flags) : '0.5');
    if (process.platform === 'win32' && !benchmark) {
      const gaps = await page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const sample = {
              previous: 0,
              gaps: [] as number[],
              frame(this: void, now: number) {
                if (sample.previous) sample.gaps.push(now - sample.previous);
                sample.previous = now;
                if (sample.gaps.length === 6) resolve(sample.gaps);
                else requestAnimationFrame(sample.frame);
              },
            };
            requestAnimationFrame(sample.frame);
          }),
      );
      console.log(
        `Game frame cadence: ${gaps.map((gap) => Math.round(gap)).join(', ')}ms; visible=${await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())}.`,
      );
    }
    await markStage('pause-menu');
    const focused = () => page.evaluate(() => document.activeElement?.id);
    assert.equal(await focused(), 'resume');
    await page.keyboard.press('Shift+Tab');
    await page.waitForFunction(
      () => !!document.activeElement?.closest('#modal'),
      {},
      { timeout: 1000 },
    );
    await page.keyboard.press('Tab');
    assert.equal(await focused(), 'resume');
    await page.locator('#new-game').focus();
    await page.keyboard.down('Enter');
    await page.locator('#new-confirm').waitFor({ state: 'visible' });
    assert.equal(await focused(), 'cancel-new');
    await page.keyboard.down('Enter');
    assert.equal(await page.locator('#new-confirm').isVisible(), true);
    await page.keyboard.up('Enter');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#new-confirm').isVisible(), false);
    assert.equal(await page.locator('#modal').isVisible(), true);
    assert.equal(await focused(), 'new-game');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#modal').isVisible(), false);
    assert.equal(await focused(), 'pause');
    await page.locator('canvas').focus();
    await page.keyboard.press('Escape');
    assert.equal(await focused(), 'resume');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'CANVAS');
    await page.getByRole('button', { name: 'Pause / save' }).click();
    checks.push(
      'pause contains focus, restores its opener, and Escape cancels confirmation before resuming',
    );
    const checkpoint = path.join(run.profile, 'prototype-saves/game.json'),
      newerSave = JSON.stringify({ version: 99 });
    await fs.mkdir(path.dirname(checkpoint), { recursive: true });
    await fs.writeFile(checkpoint, newerSave);
    await page.locator('#new-game').click();
    await page.locator('#confirm-new').click();
    await page.waitForFunction(
      () => !document.querySelector<HTMLDialogElement>('#new-confirm')!.open,
    );
    assert.equal(JSON.parse(await fs.readFile(checkpoint, 'utf8')).version, 6);
    await pause();
    checks.push('New Game replaces obsolete prototype data with the current format');
    let save = await observe();
    assert.equal(save.area, 'empty');
    assert.deepEqual(save.areas.empty!.actors, {});
    assert.equal(save.wins, 0);
    assert.equal(save.player.health, 100);
    assert.equal(await page.locator('#objective').textContent(), 'Explore the scene');
    const measurement = benchmark ? await startGameBenchmark(run, save) : undefined;
    await measurement?.phase('movement');
    const initial = { ...save.player };
    await resume();
    await page.locator('canvas').focus();
    await page.keyboard.down('KeyW');
    try {
      await page.waitForTimeout(benchmark ? 2200 : 500);
    } finally {
      await page.keyboard.up('KeyW');
    }
    save = await observe();
    assert.ok(Math.hypot(save.player.x - initial.x, save.player.z - initial.z) > 0.1);
    checks.push('empty Game launches without encounters and accepts player movement');
    await measurement?.phase('actions');
    await resume();
    await page.mouse.click(500, 350);
    await renderedFrames();
    await page.waitForTimeout(benchmark ? 2200 : 900);
    await page.mouse.click(500, 350, { button: 'right' });
    await page.waitForFunction(
      () => document.querySelector('#ability-status')?.textContent !== 'RMB · ready',
    );
    await page.waitForTimeout(benchmark ? 1500 : 750);
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Shift');
    try {
      await page.waitForFunction(
        () => document.querySelector('#dodge-status')?.textContent !== 'Shift · ready',
      );
    } finally {
      await page.keyboard.up('Shift');
      await page.keyboard.up('KeyD');
    }
    save = await observe();
    assert.ok(save.player.cooldown > 0);
    assert.ok(save.player.dodgeCooldown > 0);
    assert.equal(save.wins, 0);
    checks.push('flare and dodge retain accepted cooldowns without awarding empty-room victories');
    await measurement?.phase('checkpoint');
    const frozen = await fs.readFile(checkpoint);
    await page.waitForTimeout(300);
    assert.deepEqual(await fs.readFile(checkpoint), frozen);
    await page.locator('#load').click();
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'Checkpoint loaded',
    );
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'CANVAS');
    const restored = await observe();
    assert.deepEqual(restored.player, save.player);
    await resume();
    await page.waitForTimeout(benchmark ? 2200 : 100);
    await pause();
    await page.locator('#reset').click();
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'Encounter reset',
    );
    save = await observe();
    assert.equal(save.player.health, 100);
    assert.equal(save.player.x, 0);
    assert.equal(save.player.z, 0);
    assert.equal(save.wins, 0);
    checks.push('pause, checkpoint restore and reset remain usable on empty Game');
    await resume();
    await capture('empty-game');
    await measurement?.finish();
    assert.deepEqual(errors, []);
    await measurement?.publish();
    await fs.rm(path.join(output, 'failure.json'), { force: true });
    await fs.writeFile(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          checks,
          errors,
          save,
          platform: process.platform,
          limitations: [
            'Package verification covers this host; visible display pacing is unverified.',
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${checks.length} Game checks; ${run.capture ? output : 'verified; successful diagnostics discarded'}`,
    );
  } catch (error) {
    let checkpoint: unknown;
    try {
      await page.screenshot({ path: path.join(output, 'failure.png') });
      if (!(await page.locator('#modal').isVisible()))
        await page.getByRole('button', { name: 'Pause / save' }).click();
      await page.getByRole('button', { name: 'Save checkpoint', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#status')?.textContent === 'Checkpoint saved',
      );
      checkpoint = JSON.parse(
        await fs.readFile(path.join(run.profile, 'prototype-saves/game.json'), 'utf8'),
      );
    } catch {}
    await fs.writeFile(
      path.join(output, 'failure.json'),
      JSON.stringify({ stage, error: String(error), errors, checks, checkpoint }, null, 2),
    );
    throw error;
  } finally {
    await run.close();
  }
}
