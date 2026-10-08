import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Vector3 } from 'three';
import { smokeLaunch } from './smoke-launch';
import { makeCamera, resizeCamera } from '../src/core/camera';
import { heightAt, type AreaDefinition } from '../src/content/world';
import { compositionPoint, compositionHeight, compositionSpan } from '../src/content/world-art';
import type { GameSave } from '../src/core/save';
import { GameSession } from '../src/core/session';
import { content } from '../src/content/game-content';
import { _electron } from 'playwright';
import type {} from '../src/inspection';

// Routine prototype integration: actual package input, persistence and Dev isolation.
// Combat balance, traversal and save recovery retain their full unit-suite coverage.
async function player() {
  const run = await smokeLaunch(false),
    { page, errors, output } = run,
    file = path.join(run.profile, 'saves/game.json');
  let stage = 'player-startup';
  try {
    assert.equal(await page.evaluate(() => 'foundation' in window), false);
    assert.equal(await page.evaluate(() => typeof window.lantern?.launchMode), 'undefined');
    const pause = async () => {
      if (!(await page.locator('#modal').isVisible())) await page.locator('#pause').click();
    };
    const resume = async () => {
      await page.locator('#resume').click();
      await page.locator('canvas').focus();
    };
    const save = async () => {
      await pause();
      await page.locator('#save').click();
      await page.waitForFunction(
        () => document.querySelector('#status')?.textContent === 'Checkpoint saved',
      );
      return JSON.parse(await fs.readFile(file, 'utf8')) as GameSave;
    };
    const frames = () =>
      page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
    await pause();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'resume');
    await page.locator('#render-scale').selectOption('0.5');
    await page.locator('#new-game').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'cancel-new');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#new-confirm').isVisible(), false);
    assert.equal(await page.locator('#modal').isVisible(), true);
    stage = 'checkpoint-protection';
    const newer = JSON.stringify({ version: 99 });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, newer);
    await page.locator('#new-game').click();
    await page.locator('#confirm-new').click();
    await page.waitForFunction(() =>
      document.querySelector('#new-status')?.textContent?.includes('Newer save'),
    );
    assert.equal(await page.locator('#new-status').isVisible(), true);
    assert.equal(await fs.readFile(file, 'utf8'), newer);
    await page.locator('#cancel-new').click();
    await fs.rm(file);
    const initial = await save();
    stage = 'player-input';
    await resume();
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(350);
    await frames();
    await page.keyboard.up('KeyW');
    const moved = await save();
    assert.ok(
      Math.hypot(moved.player.x - initial.player.x, moved.player.z - initial.player.z) > 0.03,
    );

    // Load a normal checkpoint near an enemy, exercising real Load and aiming
    // without replaying minutes of balanced encounters on both OSes.
    const encounter = structuredClone(initial),
      state = encounter.areas[encounter.area]!,
      [id, enemy] = Object.entries(state.actors)[0]!;
    state.engaged = true;
    encounter.player.x = enemy.x;
    encounter.player.z = enemy.z + 1.1;
    await fs.writeFile(file, JSON.stringify(encounter));
    await page.locator('#load').click();
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'Checkpoint loaded',
    );
    const rect = await page.locator('canvas').boundingBox();
    assert.ok(rect);
    const surface = await run.app.evaluate(({ app }, areaId) => {
      const fs = process.getBuiltinModule('fs'),
        path = process.getBuiltinModule('path');
      return JSON.parse(
        fs.readFileSync(path.join(app.getAppPath(), 'dist/build-identity.json'), 'utf8'),
      ).rendering.areas[areaId].surface as AreaDefinition['surface'];
    }, encounter.area);
    const area = { surface } as AreaDefinition,
      span = compositionSpan(encounter.area, encounter.player, 9),
      framed = compositionPoint(encounter.area, encounter.player, {
        halfWidth: (span * rect.width) / rect.height / 2,
        halfHeight: span / 2,
      }),
      target = new Vector3(
        framed.x,
        heightAt(area, framed.x, framed.z) + compositionHeight(encounter.area, encounter.player),
        framed.z,
      ),
      camera = makeCamera(rect.width / rect.height, target);
    resizeCamera(camera, rect.width, rect.height, span);
    const point = new Vector3(enemy.x, heightAt(area, enemy.x, enemy.z), enemy.z).project(camera),
      x = rect.x + ((point.x + 1) * rect.width) / 2,
      y = rect.y + ((1 - point.y) * rect.height) / 2;
    await page.locator('canvas').focus();
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(250);
      await frames();
    }
    const struck = await save();
    assert.ok(
      struck.areas[struck.area]!.actors[id]!.health < enemy.health,
      'Mouse sword input must damage an enemy',
    );
    await resume();
    for (let i = 0; i < 4; i++) {
      await page.mouse.click(x, y, { button: 'right' });
      await page.waitForTimeout(250);
      if ((await page.locator('#ability-status').textContent()) !== 'RMB · ready') break;
    }
    assert.notEqual(await page.locator('#ability-status').textContent(), 'RMB · ready');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift');
      await page.waitForTimeout(200);
      if ((await page.locator('#dodge-status').textContent()) !== 'Shift · ready') break;
    }
    assert.notEqual(await page.locator('#dodge-status').textContent(), 'Shift · ready');
    const saved = await save();
    // Software-renderer/UI latency may consume the cooldown before Save is clicked.
    // Input feedback above is the platform contract; positive-cooldown saving is
    // protected by the shared Game journey and pure persistence/action suites.
    stage = 'checkpoint-roundtrip';
    await page.locator('#load').click();
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'Checkpoint loaded',
    );
    const restored = await save();
    assert.equal(restored.area, saved.area);
    assert.equal(restored.wins, saved.wins);
    assert.equal(restored.player.dodgeCooldown, saved.player.dodgeCooldown);
    assert.equal(
      restored.areas[restored.area]!.actors[id]!.health,
      saved.areas[saved.area]!.actors[id]!.health,
    );
    assert.ok(
      Math.hypot(restored.player.x - saved.player.x, restored.player.z - saved.player.z) < 0.03,
    );
    stage = 'restart-preferences-and-load';
    await page.locator('#zoom-span').selectOption('13');
    await page.waitForFunction(async () => {
      const settings = await window.lantern!.loadSettings();
      return (
        (settings.status === 'ok' || settings.status === 'recovered') &&
        settings.data.verticalSpan === 13
      );
    });
    await run.app.close();
    console.log('Smoke launch: Game (process restart).');
    const restarted = await _electron.launch({
      executablePath: run.executable,
      args: process.platform === 'win32' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
      env: {
        ...process.env,
        LANTERN_USER_DATA: run.profile,
        LANTERN_AUTOMATED_RUN: '1',
        LANTERN_TEST_HIDDEN: '1',
      },
      timeout: 30_000,
    });
    try {
      const page = await restarted.firstWindow();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true');
      assert.equal(await page.locator('#zoom-span').inputValue(), '13');
      await page.locator('#load').click();
      await page.waitForFunction(
        () => document.querySelector('#status')?.textContent === 'Checkpoint loaded',
      );
      const loaded = await page.evaluate(() => window.lantern!.loadGame());
      assert.ok(loaded.status === 'ok' || loaded.status === 'recovered');
      if (loaded.status === 'ok' || loaded.status === 'recovered')
        assert.deepEqual(loaded.data, restored);
      // Seed the scenario boundary; Load, scene construction and rendering are production paths.
      await fs.writeFile(
        file,
        JSON.stringify(new GameSession(content, 142, 'upper-landing').captureSave()),
      );
      await page.locator('#load').click();
      await page.waitForFunction(
        () => document.querySelector('#room-title')?.textContent === 'Ruined Chapel',
      );
      assert.equal(
        await page.evaluate(() => {
          const canvas = document.querySelector('canvas')!,
            gl = canvas.getContext('webgl2')!;
          return (
            canvas.width > 0 &&
            canvas.height > 0 &&
            !gl.isContextLost() &&
            gl.getError() === gl.NO_ERROR
          );
        }),
        true,
        'Chapel framebuffer and shaders must be usable',
      );
    } finally {
      await restarted.close();
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS: player startup, pause, checkpoint protection, movement, sword, lantern, dodge and save/load.',
    );
  } catch (error) {
    await fs.writeFile(
      path.join(output, 'failure.json'),
      JSON.stringify({ stage, error: String(error), errors }),
    );
    throw error;
  } finally {
    await run.close();
  }
}

async function developer() {
  const run = await smokeLaunch(true),
    { page, errors, output } = run;
  let stage = 'sandbox-startup';
  try {
    await page.waitForFunction(() => window.foundation?.ready, {}, { timeout: 30000 });
    if (!(await page.locator('#modal').isVisible())) await page.locator('#pause').click();
    await page.locator('#render-scale').selectOption('0.5');
    await page.locator('#resume').click();
    assert.equal(await page.evaluate(() => window.foundation.sim.enemies.length), 1);
    stage = 'preview-isolation';
    await page.getByRole('button', { name: 'Play Opening Scene', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('canvas')?.dataset.ready === 'true' && !('foundation' in window),
      {},
      { timeout: 30000 },
    );
    assert.equal(await page.evaluate(() => typeof window.lantern?.launchMode), 'function');
    if (!(await page.locator('#modal').isVisible())) await page.locator('#pause').click();
    await page.locator('#render-scale').selectOption('0.5');
    await page.locator('#save').click();
    await page.waitForFunction(
      () => document.querySelector('#status')?.textContent === 'Checkpoint saved',
    );
    await fs.access(path.join(run.profile, 'preview/saves/game.json'));
    await assert.rejects(fs.access(path.join(run.profile, 'sandbox/saves/game.json')), {
      code: 'ENOENT',
    });
    assert.equal(
      await page.getByRole('button', { name: 'Return to Sandbox', exact: true }).count(),
      1,
    );
    assert.deepEqual(errors, []);
    console.log('PASS: Dev startup, Preview routing and checkpoint isolation.');
  } catch (error) {
    await fs.writeFile(
      path.join(output, 'failure.json'),
      JSON.stringify({ stage, error: String(error), errors }),
    );
    throw error;
  } finally {
    await run.close();
  }
}

await player();
await developer();
