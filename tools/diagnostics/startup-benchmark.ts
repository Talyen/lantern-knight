import { runCli } from '../cli';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { smokeLaunch, smokeExecutable, playerControls, option } from '../smoke/smoke-launch';
import { desktopEnvironment } from './environment';
import { frameSummary } from './benchmark-model';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import { tuning } from '../../src/content/gameplay';
import { requireCurrentDesktopInputs } from '../build-identity';
import { writeJson } from '../json-file';
import { digest } from '../source-identity';

async function startupBenchmark(flags: string[]) {
  const samples = Number(option('--samples', '5', flags));
  assert.ok(Number.isInteger(samples) && samples >= 5 && samples <= 100, 'Use 5–100 samples');
  assert.ok(flags.includes('--output'), 'Supply an external --output directory');
  const output = path.resolve(option('--output', '', flags));
  await fs.mkdir(output, { recursive: true });
  const baseline = flags.includes('--baseline-executable')
    ? path.resolve(option('--baseline-executable', '', flags))
    : undefined;
  const baselineAssets = flags.includes('--baseline-asset-sha256')
    ? option('--baseline-asset-sha256', '', flags)
    : undefined;
  assert.ok(
    !baselineAssets || (baseline && /^[a-f0-9]{64}$/.test(baselineAssets)),
    'A baseline asset identity requires an explicit baseline executable',
  );
  const conditions = baseline ? (['baseline', 'candidate'] as const) : (['candidate'] as const);
  const records: Record<string, unknown>[] = [];
  const scenarios = ['fresh', ...content.definitions.areas.map((a) => a.id)];
  const selectedScenario = option('--scenario', 'all', flags);
  assert.ok(
    selectedScenario === 'all' || scenarios.includes(selectedScenario),
    'Unknown startup scenario',
  );
  for (const scenario of scenarios.filter(
    (scenario) => selectedScenario === 'all' || scenario === selectedScenario,
  )) {
    const expected = new GameSession(
      content,
      142,
      scenario === 'fresh' ? content.definitions.initialArea : scenario,
    ).captureSave();
    for (let sample = 0; sample < samples; sample++) {
      for (const condition of sample % 2 ? [...conditions].reverse() : conditions) {
        const directory = path.join(output, `${scenario}-${condition}-${sample + 1}`);
        const run = await smokeLaunch(
          false,
          process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : [],
          {
            flags: [...flags.filter((f) => f !== '--output'), '--output', directory],
            executable: condition === 'baseline' ? baseline : smokeExecutable(false),
            initialSave: scenario === 'fresh' ? undefined : expected,
            startupTimeoutMs: 45000,
            retain: true,
            budget: 32 * 1024 ** 2,
          },
        );
        try {
          const loaded = await run.app.evaluate(({ app }) => {
            const fs = process.getBuiltinModule('fs'),
              path = process.getBuiltinModule('path');
            return JSON.parse(
              fs.readFileSync(path.join(app.getAppPath(), 'dist/build-identity.json'), 'utf8'),
            ) as {
              inputSha256: string;
              sourceCommit: string;
              assets: { sha256: string };
              files: Record<string, string>;
            };
          });
          if (condition === 'candidate') await requireCurrentDesktopInputs(loaded);
          assert.equal(
            loaded.assets.sha256,
            condition === 'baseline' && baselineAssets
              ? baselineAssets
              : process.env.LANTERN_ASSET_SHA256,
            'Startup package uses a different asset pin',
          );
          await run.app.evaluate(({ BrowserWindow, app }) => {
            app.focus({ steal: true });
            BrowserWindow.getAllWindows()[0]?.focus();
          });
          await run.page.bringToFront();
          await run.page.evaluate(() => Reflect.set(window, '__name', (fn: Function) => fn));
          const observation = await run.page.evaluate(() => {
            const canvas = document.querySelector('canvas')!,
              gl = canvas.getContext('webgl2')!,
              info = gl.getExtension('WEBGL_debug_renderer_info');
            return {
              documentToReadyObservationMs: performance.now(),
              documentToReadyMs:
                performance.getEntriesByName('lantern-startup:ready')[0]?.startTime ?? null,
              navigation: performance.getEntriesByType('navigation').map((e) => e.toJSON()),
              stages: performance
                .getEntriesByType('measure')
                .filter((e) => e.name.startsWith('lantern-startup:'))
                .map((e) => ({ name: e.name, startMs: e.startTime, durationMs: e.duration })),
              resources: performance.getEntriesByType('resource').map((e) => ({
                name: e.name,
                startMs: e.startTime,
                durationMs: e.duration,
                bytes: (e as PerformanceResourceTiming).encodedBodySize,
              })),
              gpu: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
              viewport: [canvas.clientWidth, canvas.clientHeight],
              buffer: [canvas.width, canvas.height],
              dpr: devicePixelRatio,
            };
          });
          const readyMemory = await run.app.evaluate(({ app }) =>
            app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, ...memory })),
          );
          assert.doesNotMatch(
            observation.gpu,
            /swiftshader|llvmpipe|software|unavailable/i,
            'Startup qualification needs an observed hardware GPU',
          );
          const environment = {
            ...(await desktopEnvironment(run)),
            gpu: observation.gpu,
            viewport: observation.viewport,
            buffer: observation.buffer,
            dpr: observation.dpr,
          };
          await run.page.evaluate(() => {
            Reflect.set(window, '__name', (fn: Function) => fn);
            const frames: number[] = [];
            let last = 0;
            Reflect.set(window, '__startupFrames', frames);
            const sample = (now: number) => {
              if (last) frames.push(now - last);
              last = now;
              if (frames.length < 600 && Reflect.get(window, '__startupFrames') === frames)
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          let focusInterruptions = 0;
          const focusGame = async () => {
            await run.app.evaluate(({ BrowserWindow, app }) => {
              app.focus({ steal: true });
              BrowserWindow.getAllWindows()[0]?.focus();
            });
            if (await run.page.locator('#menu-start').isVisible())
              await run.page.locator('#menu-start').click();
            else if (await run.page.locator('#modal').isVisible()) {
              focusInterruptions++;
              await run.page.locator('#resume').click();
            }
            await run.page.locator('canvas').focus();
          };
          await focusGame();
          // First inputs occur immediately after readiness, with no texture warmup delay.
          await run.page.locator('canvas').focus();
          await run.page.locator('canvas').click();
          // Let the real attack finish before testing dodge admission.
          await run.page.waitForTimeout((tuning.attack.total * 1000) / 60 + 100);
          await focusGame();
          await run.page.keyboard.down('KeyW');
          await run.page.keyboard.press('Shift');
          await run.page.waitForTimeout(600);
          await run.page.keyboard.up('KeyW');
          await run.page.waitForFunction(
            () => (Reflect.get(window, '__startupFrames') as number[]).length >= 60,
            {},
            { timeout: 10000 },
          );
          await focusGame();
          await run.page.locator('canvas').click({ button: 'right' });
          await run.page.waitForTimeout(700);
          await focusGame();
          await run.page.keyboard.down('KeyD');
          await run.page.waitForTimeout(700);
          await run.page.keyboard.up('KeyD');
          const frames = await run.page.evaluate(() => {
            const frames = Reflect.get(window, '__startupFrames') as number[];
            Reflect.set(window, '__startupFrames', undefined);
            return frames;
          });
          if (run.capture)
            await run.page.screenshot({ path: path.join(directory, 'first-actions.png') });
          const saved = await playerControls(run.page, run.profile).save();
          assert.equal(saved.area, expected.area);
          assert.equal(
            saved.player.nextAttack,
            expected.player.nextAttack === 'lunge' ? 'sweep' : 'lunge',
            'Startup must accept the first real sword action',
          );
          assert.ok(saved.player.cooldown > 0, 'Startup must accept a real lantern action');
          assert.ok(
            saved.adventure?.onboarding?.completed.includes('dodge'),
            'Startup must accept a real dodge',
          );
          assert.ok(
            Math.hypot(saved.player.x - expected.player.x, saved.player.z - expected.player.z) >
              0.05,
            'Startup must accept real movement',
          );
          assert.deepEqual(run.errors, []);
          const record = {
            scenario,
            condition,
            sample: sample + 1,
            build: {
              commit: loaded.sourceCommit,
              inputSha256: loaded.inputSha256,
              filesSha256: digest(loaded.files),
              assets: loaded.assets.sha256,
            },
            environment,
            checkpoint: digest(expected),
            launchToReadyMs: run.readyMs,
            ...observation,
            memoryKiB: {
              ready: readyMemory,
              afterActions: await run.app.evaluate(({ app }) =>
                app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, ...memory })),
              ),
            },
            focusInterruptions,
            firstActions: frameSummary(frames),
          };
          records.push(record);
          await writeJson(path.join(directory, 'startup.json'), record);
          console.log(
            `${scenario} ${condition} ${sample + 1}: ${run.readyMs.toFixed(0)} ms; first-action worst frame ${record.firstActions.worstMs.toFixed(0)} ms`,
          );
        } catch (error) {
          if (run.capture) await run.page.screenshot({ path: path.join(directory, 'failure.png') });
          await run.writeReport('failure.json', {
            scenario,
            condition,
            sample: sample + 1,
            error: String(error),
            errors: run.errors,
            state: await run.page.evaluate(() => ({
              focused: document.hasFocus(),
              hidden: document.hidden,
              paused: document.querySelector('#modal')?.getAttribute('open'),
              status: document.querySelector('#status')?.textContent,
              sword: document.querySelector('#sword-status')?.textContent,
              dodge: document.querySelector('#dodge-status')?.textContent,
              ability: document.querySelector('#ability-status')?.textContent,
            })),
          });
          throw error;
        } finally {
          await run.close();
        }
      }
    }
  }
  const summaries = [];
  for (const scenario of [...new Set(records.map((r) => r.scenario))]) {
    const group = records.filter((r) => r.scenario === scenario);
    const signature = (r: Record<string, unknown>) =>
      digest({
        environment: r.environment,
        checkpoint: r.checkpoint,
        assets: baselineAssets ? undefined : (r.build as { assets: string }).assets,
      });
    assert.equal(new Set(group.map(signature)).size, 1, 'Startup comparison conditions differ');
    for (const condition of conditions) {
      const times = group
        .filter((r) => r.condition === condition)
        .map((r) => r.launchToReadyMs as number)
        .sort((a, b) => a - b);
      summaries.push({
        scenario,
        condition,
        samples: times.length,
        medianMs: times[Math.floor(times.length / 2)],
        minMs: times[0],
        maxMs: times.at(-1),
        p95Ms: times[Math.ceil(times.length * 0.95) - 1],
        target:
          times.length >= 20
            ? times[Math.ceil(times.length * 0.95) - 1]! < 10000
              ? 'met on measured hardware'
              : 'missed'
            : 'provisional: fewer than 20 samples',
      });
    }
  }
  await writeJson(path.join(output, 'summary.json'), {
    summaries,
    limitations: [
      'Fresh user profiles and fresh processes; OS disk cache is uncontrolled.',
      'Reference Windows hardware qualification is separate from macOS results.',
      'Stage durations overlap and must not be summed.',
      'First-action frame callbacks are not GPU presentation timing.',
      'Runs with focusInterruptions do not qualify foreground gameplay pacing.',
      'Process working sets and high-water marks are KiB observations, not portable GPU allocation measurements; summing shared pages can double-count memory.',
      ...(baselineAssets
        ? [
            'Different prepared asset pins were explicitly admitted; source-pixel and native rendered parity require separate verification.',
          ]
        : []),
    ],
    records,
  });
  console.log(JSON.stringify(summaries, null, 2));
}
runCli(import.meta.url, (args) => startupBenchmark(args));
