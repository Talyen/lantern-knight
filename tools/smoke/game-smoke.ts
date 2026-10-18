import { readJson } from '../json-file';
import { checkLoadingScreen } from './loading-screen';
import { startGameBenchmark } from '../diagnostics/game-benchmark';
import { heroTimings } from '../../src/content/hero-actions';
import { maximumFrameMs } from '../../src/core/simulation';
import { content } from '../../src/content/game-content';
import { parseGame } from '../../src/core/save';
import { option, playerControls } from './smoke-launch';
import { scenario } from './scenario';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function runScenario(flags: string[] = []) {
  const benchmark = flags.includes('--benchmark');
  await scenario(
    false,
    flags,
    async (run, details) => {
      const { page, app } = run;
      const checks: string[] = [];
      details.checks = checks;
      const {
        pause,
        resume,
        save: observe,
        load,
        checkpoint: checkpointAction,
        frames,
      } = playerControls(page, run.profile);
      const checkpoint = path.join(run.profile, 'prototype-saves/game.json');
      const gameplayTime = (durationMs: number) =>
        page.evaluate(
          ({ durationMs, maximumFrameMs }) =>
            new Promise<void>((resolve) => {
              let previous = performance.now(),
                elapsed = 0;
              const frame = (now: number) => {
                elapsed += Math.max(0, Math.min(maximumFrameMs, now - previous));
                previous = now;
                if (elapsed >= durationMs) resolve();
                else requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            }),
          { durationMs, maximumFrameMs },
        );
      const actionTime = (clip: string) =>
        Math.max(
          benchmark ? 2200 : 0,
          ...Object.values(heroTimings[clip]!).map(
            (recipe) => (recipe?.holdsMs.reduce((sum, ms) => sum + ms, 0) ?? 0) + 50,
          ),
        );
      await checkLoadingScreen(run, false);
      await app.evaluate(
        ({ BrowserWindow }, benchmark) =>
          BrowserWindow.getAllWindows()[0]!.setContentSize(
            benchmark ? 2560 : 1280,
            benchmark ? 1440 : 800,
          ),
        benchmark,
      );
      assert.equal(
        await page.evaluate(
          () => Reflect.has(window, 'foundation') || !!window.lantern?.launchMode,
        ),
        false,
      );
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#menu-start').isVisible(), true);
      await run.capturePage('main-menu');
      await page.locator('#menu-settings').click();
      await page
        .locator('#render-scale')
        .selectOption(benchmark ? option('--render-scale', '1', flags) : '0.5');
      await page.locator('#menu-back').click();
      await page.locator('#menu-start').click();
      await pause();
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'resume');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('#modal')), true);
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'resume');
      await page.locator('#checkpoint-options > summary').click();
      await page.locator('#new-game').focus();
      await page.keyboard.down('Enter');
      await page.locator('#new-confirm').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'cancel-new');
      await page.keyboard.down('Enter');
      assert.equal(await page.locator('#new-confirm').isVisible(), true);
      await page.keyboard.up('Enter');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#new-confirm').isVisible(), false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'new-game');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#new-game').isVisible(), false);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'CANVAS');
      checks.push('title admission, contained pause focus and nested confirmation cancellation');
      await fs.writeFile(checkpoint, JSON.stringify({ version: 99 }));
      await pause();
      await checkpointAction('new-game');
      await page.locator('#confirm-new').click();
      await page.waitForFunction(
        () => !document.querySelector<HTMLDialogElement>('#new-confirm')!.open,
      );
      const initial = parseGame(await readJson(checkpoint), content);
      assert.equal(initial.area, content.definitions.initialArea);
      checks.push('New Game replaces obsolete storage with a valid current authored checkpoint');
      const measurement = benchmark ? await startGameBenchmark(run, initial) : undefined;
      await measurement?.phase('movement');
      await resume();
      await page.keyboard.down('KeyW');
      try {
        await page.waitForTimeout(benchmark ? 2200 : 500);
      } finally {
        await page.keyboard.up('KeyW');
      }
      let save = await observe();
      assert.ok(
        Math.hypot(save.player.x - initial.player.x, save.player.z - initial.player.z) > 0.1,
      );
      checks.push('authored Game accepts real player movement');
      await measurement?.phase('actions');
      await resume();
      await page.mouse.click(500, 350);
      await frames();
      await gameplayTime(Math.max(actionTime('sweep'), actionTime('lunge')));
      await page.mouse.click(500, 350, { button: 'right' });
      await gameplayTime(actionTime('cast_lantern_flare'));
      await page.keyboard.down('KeyD');
      await page.keyboard.press('Shift');
      await frames();
      await page.keyboard.up('KeyD');
      save = await observe();
      assert.ok(save.player.cooldown > 0 && save.player.dodgeCooldown > 0);
      checks.push('lantern and dodge inputs retain accepted cooldowns');
      await measurement?.phase('checkpoint');
      const frozen = await fs.readFile(checkpoint);
      await page.waitForTimeout(300);
      assert.deepEqual(await fs.readFile(checkpoint), frozen);
      await load();
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'CANVAS');
      const restored = await observe();
      for (const field of ['x', 'z', 'health'] as const)
        assert.equal(restored.player[field], save.player[field]);
      for (const field of ['cooldown', 'dodgeCooldown'] as const)
        assert.ok(restored.player[field] >= 0 && restored.player[field] <= save.player[field]);
      await resume();
      await page.waitForTimeout(benchmark ? 2200 : 100);
      await pause();
      await checkpointAction('reset');
      await page.waitForFunction(
        () => document.querySelector('#status')?.textContent === 'Encounter reset',
      );
      save = parseGame(await observe(), content);
      assert.deepEqual(
        [save.player.x, save.player.z, save.player.health],
        [initial.player.x, initial.player.z, initial.player.health],
      );
      checks.push('pause freezes checkpoint bytes; load and reset restore current authored state');
      await resume();
      await run.capturePage('game');
      await measurement?.finish();
      assert.deepEqual(run.errors, []);
      await measurement?.publish();
      await run.writeReport('report.json', {
        checks,
        save,
        platform: process.platform,
        limitations: [
          'Package verification covers this host; visible display pacing is unverified.',
        ],
      });
      console.log(`PASS: ${checks.length} Game checks`);
    },
    { retain: benchmark },
    flags.includes('--software') ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
  );
}
