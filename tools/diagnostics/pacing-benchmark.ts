import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../cli';
import { writeJson } from '../json-file';
import { smokeLaunch, smokeExecutable, playerControls, option } from '../smoke/smoke-launch';
import { withDiagnostic } from '../smoke/scenario';
import { desktopEnvironment } from './environment';
import { requireCurrentDesktopInputs } from '../build-identity';
import { digest, sourceInputHash } from '../source-identity';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { supportedPosition } from '../../src/content/world';
import { clearSegment, isSupportedPosition } from '../../src/content/collision';
import { PacingSchema, pacingAcceptance } from './pacing-model';
import { installPacingRecorder, readPacingRecorder } from './pacing-recorder';

// All controls and observations cross the packaged player's public UI/storage.
// This harness adds no inspection capability to production Game.
async function pacing(flags: string[]) {
  const harnessFiles = [
    'tools/diagnostics/pacing-benchmark.ts',
    'tools/diagnostics/pacing-model.ts',
    'tools/diagnostics/pacing-recorder.ts',
    'tools/smoke/smoke-launch.ts',
    'tools/smoke/scenario.ts',
  ];
  const harness = { sha256: await sourceInputHash(process.cwd(), { files: harnessFiles }) };
  assert.ok(flags.includes('--visible'), 'Pacing qualification requires --visible');
  assert.ok(flags.includes('--output'), 'Supply an external --output directory');
  const durationMs = Number(option('--duration-ms', '60000', flags));
  const samples = Number(option('--samples', '5', flags));
  assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 20, 'Use 1–20 samples');
  assert.ok(
    Number.isFinite(durationMs) && durationMs >= 5000 && durationMs <= 900000,
    'Use 5000–900000 ms',
  );
  const output = path.resolve(option('--output', '', flags));
  const baseline = option('--baseline-executable', '', flags);
  const selected = option('--scenario', 'all', flags);
  const scenarios = [...content.definitions.areas.map((a) => a.id), 'stress'];
  assert.ok(selected === 'all' || scenarios.includes(selected), 'Unknown pacing scenario');
  await fs.mkdir(output, { recursive: true });
  for (const scenario of scenarios.filter((s) => selected === 'all' || selected === s)) {
    const area = content.area(scenario === 'stress' ? content.definitions.initialArea : scenario);
    const session = new GameSession(content, 142, area.id);
    const first = area.spawns[0]!;
    const approach = Array.from({ length: 16 }, (_, i) => ({
      x: first.x + Math.cos(0.42 + (i * Math.PI) / 8) * 1.2,
      z: first.z + Math.sin(0.42 + (i * Math.PI) / 8) * 1.2,
    })).find((p) => isSupportedPosition(area, p, 0.3) && clearSegment(area, p, first, 0.001));
    assert.ok(approach, `No visible encounter approach in ${area.id}`);
    Object.assign(session.sim.hero, approach);
    const seed = session.captureSave();
    if (scenario === 'stress')
      for (const [i, actor] of Object.values(seed.areas[area.id]!.actors).entries()) {
        Object.assign(
          actor,
          supportedPosition(
            area,
            { x: seed.player.x + Math.cos(i) * 1.8, z: seed.player.z + Math.sin(i) * 1.8 },
            0.3,
          ),
        );
      }
    parseGame(seed, content);
    const conditions = baseline ? (['baseline', 'candidate'] as const) : (['candidate'] as const);
    for (let sample = 0; sample < samples; sample++)
      for (const condition of sample % 2 ? [...conditions].reverse() : conditions) {
        const directory = path.join(output, `${scenario}-${condition}-${sample + 1}`);
        const run = await smokeLaunch(
          false,
          process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : [],
          {
            flags: ['--visible', '--output', directory],
            executable: condition === 'baseline' ? baseline : smokeExecutable(false),
            initialSave: seed,
            retain: true,
            startupTimeoutMs: 60000,
            laneWaitMs: 30 * 60_000,
          },
        );
        await withDiagnostic(run, async () => {
          const loaded = await run.app.evaluate(({ app }) => {
            const fs = process.getBuiltinModule('fs'),
              p = process.getBuiltinModule('path');
            return JSON.parse(
              fs.readFileSync(p.join(app.getAppPath(), 'dist/build-identity.json'), 'utf8'),
            ) as {
              inputSha256: string;
              sourceCommit: string;
              dirty: boolean;
              assets: { sha256: string };
              files: Record<string, string>;
            };
          });
          if (condition === 'candidate') await requireCurrentDesktopInputs(loaded);
          assert.equal(
            loaded.assets.sha256,
            process.env.LANTERN_ASSET_SHA256,
            'Pacing asset pin differs',
          );
          await run.app.evaluate(({ BrowserWindow, screen, app }) => {
            const w = BrowserWindow.getAllWindows()[0]!,
              display = screen.getDisplayMatching(w.getBounds());
            w.setContentSize(display.bounds.width, display.bounds.height);
            w.show();
            if (process.platform === 'darwin') w.setSimpleFullScreen(true);
            else w.setFullScreen(true);
            app.focus({ steal: true });
            w.focus();
          });
          await run.page.bringToFront();
          await run.page.evaluate(() => Reflect.set(window, '__name', (fn: Function) => fn));
          const { page } = run,
            controls = playerControls(page, run.profile);
          await page.locator('#menu-settings').click();
          await page.locator('#render-scale').selectOption('1');
          await page.locator('#menu-back').click();
          const environment = {
            ...(await desktopEnvironment(run)),
            ...(await page.evaluate(() => {
              const c = document.querySelector('canvas')!,
                gl = c.getContext('webgl2')!,
                info = gl.getExtension('WEBGL_debug_renderer_info');
              return {
                viewport: [c.clientWidth, c.clientHeight],
                buffer: [c.width, c.height],
                dpr: devicePixelRatio,
                gpu: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
                webgl: String(gl.getParameter(gl.VERSION)),
                settings: Object.fromEntries(
                  [
                    ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
                      '#modal input,#modal select',
                    ),
                  ].map((e, index) => [
                    e.id ||
                      e.dataset.visualEffect ||
                      (e.dataset.audio ? 'audio:' + e.dataset.audio : 'control:' + index),
                    e instanceof HTMLInputElement && e.type === 'checkbox' ? e.checked : e.value,
                  ]),
                ),
              };
            })),
            scenario,
            warmupMs: 0,
            assets: loaded.assets.sha256,
          };
          assert.doesNotMatch(environment.gpu, /software|swiftshader|unavailable|llvmpipe/i);
          const actions: string[] = [];
          await page.evaluate(installPacingRecorder);
          await controls.resume();
          actions.push('lantern', 'dodge');
          await page.mouse.click(environment.viewport[0]! * 0.48, environment.viewport[1]! * 0.48, {
            button: 'right',
          });
          await page.waitForTimeout(1600);
          await page.keyboard.down('KeyW');
          await page.keyboard.press('Shift');
          await page.waitForTimeout(150);
          await page.keyboard.up('KeyW');
          const accepted = parseGame(await controls.save(), content);
          assert.equal(accepted.area, area.id, 'First actions left the selected encounter');
          await controls.resume();
          for (let cycle = 0; cycle < Math.ceil(durationMs / 800); cycle++) {
            const key = ['KeyW', 'KeyA', 'KeyS', 'KeyD'][cycle % 4]!;
            actions.push(key, 'sword', 'lantern', 'dodge');
            await page.keyboard.down(key);
            await page.mouse.click(
              environment.viewport[0]! * 0.48,
              environment.viewport[1]! * 0.48,
            );
            await page.mouse.click(
              environment.viewport[0]! * 0.48,
              environment.viewport[1]! * 0.48,
              { button: 'right' },
            );
            await page.keyboard.press('Shift');
            await page.waitForTimeout(800);
            await page.keyboard.up(key);
            if (cycle % 6 === 5) await page.keyboard.press('KeyQ');
            if (cycle % 12 === 11 && cycle + 1 < Math.ceil(durationMs / 800)) {
              actions.push('restore-encounter');
              await controls.pause();
              await fs.writeFile(
                path.join(run.profile, 'prototype-saves/game.json'),
                JSON.stringify(seed),
              );
              await page.locator('#load').click();
              await page.waitForFunction(
                () =>
                  document.querySelector('#status')?.textContent === 'Checkpoint loaded' &&
                  !document.body.classList.contains('traveling'),
              );
              await page.locator('canvas').focus();
            }
          }
          const recording = await page.evaluate(readPacingRecorder);
          assert.equal(recording.overflow, false, 'Pacing recording exceeded its bounded budget');
          // Capture outside the measured interval; image encoding cannot manufacture a hitch.
          await page.screenshot({ path: path.join(directory, 'game.png') });
          const final = parseGame(await controls.save(), content);
          assert.equal(final.area, area.id, 'Pacing left the selected encounter');
          const beforeActors = seed.areas[area.id]!.actors;
          const proof = {
            moved: [accepted, final].some(
              (s) => Math.hypot(seed.player.x - s.player.x, seed.player.z - s.player.z) > 0.1,
            ),
            ability: accepted.player.cooldown > 0,
            dodge: accepted.player.dodgeCooldown > 0,
            combat: [accepted, final].some((s) => {
              const state = s.areas[area.id]!;
              return (
                (state.engaged || !!state.alerted?.length) &&
                (s.player.health < seed.player.health ||
                  Object.entries(state.actors).some(
                    ([id, a]) =>
                      a.health < beforeActors[id]!.health ||
                      Math.hypot(a.x - beforeActors[id]!.x, a.z - beforeActors[id]!.z) > 0.1,
                  ))
              );
            }),
          };
          const record = PacingSchema.parse({
            schemaVersion: 6,
            harness,
            recordedAt: new Date().toISOString(),
            build: {
              inputSha256: loaded.inputSha256,
              sourceCommit: loaded.sourceCommit,
              dirty: loaded.dirty,
              sha256: digest(loaded.files),
            },
            environment,
            fixture: digest(seed),
            durationMs,
            foreground: recording.foreground,
            actions,
            proof,
            frames: recording.gaps,
          });
          await writeJson(path.join(directory, 'benchmark.json'), record);
          await writeJson(path.join(directory, 'observations.json'), {
            initial: seed,
            final,
            loading: recording.loading,
            startupMs: run.readyMs,
            frameTimes: recording.times,
            inputEvents: recording.events,
          });
          console.log(
            `${scenario} ${condition} ${sample + 1}: ${JSON.stringify(pacingAcceptance(record.frames, environment.refreshHz))}; proof ${JSON.stringify(proof)}`,
          );
          assert.ok(
            Object.values(proof).every(Boolean),
            'Pacing journey did not exercise its gameplay work',
          );
          assert.deepEqual(run.errors, []);
          assert.equal(
            await sourceInputHash(process.cwd(), { files: harnessFiles }),
            harness.sha256,
            'Pacing harness changed during measurement',
          );
          if (condition === 'candidate') await requireCurrentDesktopInputs(loaded);
        });
      }
  }
}
runCli(import.meta.url, () => pacing(process.argv.slice(2)), 'message');
