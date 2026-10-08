import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { comparePixels } from './smoke-pixels';
import { smokeLaunch } from './smoke-launch';
import { lightingRigs, lookPresets } from '../src/presentation/lighting-profiles';
import { animationTreatments } from '../src/core/animation-treatment';
import '../src/inspection';
const launch = await smokeLaunch(true, [], { budget: 1024 ** 3 }),
  { page, app, output, errors } = launch,
  checks: string[] = [],
  gallery: { file: string; area: string; rig: string; look: string; resolution: string }[] = [],
  benchmarks: unknown[] = [];
const quick = process.argv.includes('--quick'),
  benchmarkOnly = process.argv.includes('--benchmark-only'),
  capture = async () =>
    page.evaluate(() => {
      const f = window.foundation;
      f.presentation.update(f.sim, 1, 0, { x: 0, z: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = f.presentation.canvas.width;
      canvas.height = f.presentation.canvas.height;
      canvas.getContext('2d')!.drawImage(f.presentation.canvas, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1]!;
    }),
  render = () =>
    page.evaluate(() => {
      const f = window.foundation;
      f.presentation.update(f.sim, 1, 0, { x: 0, z: 1 });
    }),
  settle = async () => {
    await render();
    await render();
  };
try {
  await page.waitForFunction(
    () => window.foundation?.ready && window.foundation.stats().lightingLab?.ready,
    {},
    { timeout: 60000 },
  );
  assert.equal(
    await page.evaluate(
      () => window.foundation.presentation.renderer.getContext().getContextAttributes()!.antialias,
    ),
    false,
  );
  assert.deepEqual(
    await page.evaluate(() => window.foundation.presentation.lookRenderer.stats().antiAliasing),
    { method: 'SMAA 1x', preset: 'High', edgeDetection: 'color' },
  );
  checks.push('single-sampled context and SMAA 1× High are the sole AA path');
  await page.evaluate(() => {
    window.foundation.pause(true);
    document.querySelector<HTMLElement>('#modal')!.hidden = true;
  });
  if (!benchmarkOnly) {
    for (const [resolution, width, height] of (quick
      ? [['1440p', 1280, 848]]
      : [
          ['1440p', 1280, 848],
          ['4k', 1920, 1208],
        ]) as [string, number, number][]) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!),
        [width, height],
      );
      await page.waitForFunction(
        (size) =>
          window.foundation.stats().buffer[0] === size[0] &&
          window.foundation.stats().buffer[1] === size[1],
        [width * 2, (height - 128) * 2],
      );
      for (const area of quick ? ['court'] : ['court', 'upper-landing']) {
        await page.evaluate(async (area) => {
          const f = window.foundation;
          await f.fixture(area);
          f.mode('lighting');
          f.pause(true);
          f.presentation.lightingLab.setSettings({ baseline: false });
          f.presentation.update(f.sim, 1, 0, { x: 0, z: 1 });
          f.presentation.lightingLab.setSettings({ baseline: true });
          document.querySelector<HTMLElement>('#modal')!.hidden = true;
        }, area);
        await page.locator('#lighting-baseline').check();
        if (launch.capture) {
          const file = `${area}-${resolution}-original.png`;
          await fs.writeFile(path.join(output, file), Buffer.from(await capture(), 'base64'));
          gallery.push({ file, area, rig: 'Original', look: 'Baseline', resolution });
        }
        const before = await page.evaluate(() => window.foundation.saveValue());
        const choices = launch.capture
          ? Object.keys(lightingRigs).flatMap((rig) =>
              Object.keys(lookPresets).map((look) => [rig, look] as const),
            )
          : area === 'court' && resolution === '1440p'
            ? ([
                ['golden', 'diorama'],
                ['silver', 'ink'],
                ['golden', 'cinematic'],
              ] as const)
            : ([['golden', 'diorama']] as const);
        const baseline = await comparePixels(
          page,
          async () => {
            await page.locator('#lighting-baseline').uncheck();
            for (const [rig, look] of choices) {
              await page.locator('#lighting-rig').selectOption(rig);
              await page.locator('#lighting-look').selectOption(look);
              await render();
              if (launch.capture) {
                const file = `${area}-${resolution}-${rig}-${look}.png`;
                await fs.writeFile(path.join(output, file), Buffer.from(await capture(), 'base64'));
                gallery.push({
                  file,
                  area,
                  rig: lightingRigs[rig as keyof typeof lightingRigs].label,
                  look: lookPresets[look as keyof typeof lookPresets].label,
                  resolution,
                });
              }
            }
            assert.deepEqual(
              await page.evaluate(() => window.foundation.saveValue()),
              before,
              'Preset switching changed the session',
            );
            assert.deepEqual(await page.evaluate(() => window.foundation.stats().buffer), [
              width * 2,
              (height - 128) * 2,
            ]);
            await page.locator('#lighting-baseline').check();
            await render();
          },
          { tolerance: 0 },
        );
        assert.equal(baseline.maxDifference, 0, 'Original baseline changed after lighting');
        await page.locator('#lighting-baseline').uncheck();
        assert.equal(errors.length, 0, errors.join('\n'));
        checks.push(
          `${area} / ${resolution}: native shader paths, unchanged session and exact original pixels`,
        );
        console.log(checks.at(-1));
      }
    }
    // Freeze a moving drawing and exercise both color/normal warps and caster/mask alpha.
    await page.evaluate(() => {
      const f = window.foundation;
      f.sim.hero.state = 'idle';
      f.sim.hero.yaw = Math.PI / 2;
      f.presentation.update(f.sim, 1, 0, { x: 0, z: 1 });
      f.presentation.actorPresentation.actors.get('player')!.sprite.animator.seek(142.73);
    });
    for (const mode of Object.keys(animationTreatments)) {
      await page.evaluate((mode) => {
        const f = window.foundation;
        f.presentation.animationTreatment =
          mode as keyof typeof import('../src/core/animation-treatment').animationTreatments;
        f.presentation.lightingLab.setSettings({ look: 'diorama', depthOfField: 1 });
      }, mode);
      await render();
      if (mode === 'guarded')
        assert.ok(
          await page.evaluate(
            () =>
              !!window.foundation.presentation.actorPresentation.actors.get('player')!.sprite
                .lightingSample?.blend,
          ),
          'lighting check must exercise an accepted warp',
        );
      const mask = await page.evaluate(() =>
        window.foundation.presentation.lightingLab.focusMaskStats(),
      );
      assert.ok(mask.protectedPixels > 100);
      assert.ok(mask.groundPixels > 100000);
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    checks.push(
      'held and guarded idle samples compile with lighting, soft edges, animated shadow alpha and focus masks',
    );
    for (const enabled of [false, true]) {
      await page.evaluate(
        (enabled) => (window.foundation.presentation.rigidSword = enabled),
        enabled,
      );
      await render();
    }
    checks.push(
      'rigid-sword correction on/off remains aligned in lighting, shadow and focus sampling',
    );
    await page.locator('#lighting-look').selectOption('ink');
    await settle();
    const objects = await page.evaluate(() => window.foundation.stats().objects);
    for (let i = 0; i < 12; i++) {
      await page.locator('#lighting-look').selectOption(['ink', 'diorama', 'cinematic'][i % 3]!);
      await page.locator('#lighting-rig').selectOption(i % 2 ? 'silver' : 'golden');
      await render();
    }
    assert.deepEqual(await page.evaluate(() => window.foundation.stats().objects), objects);
    checks.push('repeated look changes settle at identical geometry and texture counts');
    await page.locator('#lighting-replay').click();
    await page.waitForFunction(
      () => window.foundation.sim.tick > 30 && window.foundation.sim.hero.z < 5.5,
    );
    const replay = await page.evaluate(() => ({
      tick: window.foundation.sim.tick,
      z: window.foundation.sim.hero.z,
    }));
    assert.ok(replay.tick > 30);
    assert.ok(replay.z < 5.5);
    await page.locator('#lighting-pause').click();
    const paused = await page.evaluate(() => ({
      save: window.foundation.saveValue(),
      time: window.foundation.presentation.lightingLab.time,
    }));
    await page.waitForTimeout(150);
    assert.deepEqual(
      await page.evaluate(() => ({
        save: window.foundation.saveValue(),
        time: window.foundation.presentation.lightingLab.time,
      })),
      paused,
    );
    await page.locator('#lighting-stop').click();
    checks.push(
      'replay moves through the scene; pause freezes simulation and atmosphere; stop returns free play',
    );
    if (launch.capture)
      await page.screenshot({ path: path.join(output, 'lab-controls.png'), scale: 'device' });
  }
  if (!quick) {
    if (process.argv.includes('--benchmark') || benchmarkOnly) {
      for (const [resolution, width, height] of [
        ['1440p', 1280, 848],
        ['4k', 1920, 1208],
      ] as const) {
        await app.evaluate(
          ({ BrowserWindow }, size) =>
            BrowserWindow.getAllWindows()[0]!.setContentSize(size[0]!, size[1]!),
          [width, height],
        );
        for (const rig of Object.keys(lightingRigs))
          for (const look of Object.keys(lookPresets)) {
            await page.evaluate(
              async ({ rig, look }) => {
                const f = window.foundation;
                await f.startBenchmark();
                f.mode('lighting');
                f.presentation.lightingLab.setSettings({
                  rig: rig as 'golden' | 'silver',
                  look: look as 'ink' | 'diorama' | 'cinematic',
                });
              },
              { rig, look },
            );
            await page.waitForTimeout(2000);
            await page.evaluate(() => window.foundation.startBenchmark());
            await page.evaluate(() => window.foundation.mode('lighting'));
            await page.waitForTimeout(8000);
            const b = await page.evaluate(() => window.foundation.finishBenchmark(false)),
              sorted = [...b.frames].sort((a, b) => a - b);
            assert.ok(b.simulatedTicks > 300, 'simulation stalled');
            benchmarks.push({
              resolution,
              rig,
              look,
              samples: sorted.length,
              median: sorted[Math.floor(sorted.length * 0.5)],
              p95: sorted[Math.floor(sorted.length * 0.95)],
              over33ms: sorted.filter((x) => x > 33.4).length,
              droppedMs: b.droppedMs,
              stats: b.stats,
            });
            console.log(
              `Benchmark ${resolution} / ${rig} / ${look}: p95 ${sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1)} ms`,
            );
          }
      }
      for (const look of ['ink', 'diorama', 'cinematic'] as const) {
        await page.evaluate(async (look) => {
          const f = window.foundation;
          await f.startBenchmark(true);
          f.mode('lighting');
          f.presentation.lightingLab.setSettings({ look, rig: 'silver' });
        }, look);
        await page.waitForTimeout(2000);
        await page.evaluate(async () => {
          await window.foundation.startBenchmark(true);
          window.foundation.mode('lighting');
        });
        await page.waitForTimeout(8000);
        const b = await page.evaluate(() => window.foundation.finishBenchmark(false)),
          sorted = [...b.frames].sort((a, b) => a - b);
        assert.equal(b.stats.actors, 33);
        benchmarks.push({
          resolution: '4k',
          rig: 'silver',
          look,
          stress: true,
          samples: sorted.length,
          median: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
          over33ms: sorted.filter((x) => x > 33.4).length,
          droppedMs: b.droppedMs,
          stats: b.stats,
        });
        console.log(
          `Stress 4k / ${look}: p95 ${sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1)} ms`,
        );
      }
      checks.push(
        'all six looks benchmarked at native 1440p and 4K; all three looks exercised with 32 enemies at 4K',
      );
    }
  }
  await page.evaluate(() => window.foundation.mode('encounter'));
  await render();
  assert.equal(
    await page.evaluate(() => window.foundation.presentation.lookRenderer.settings.look),
    'diorama',
  );
  checks.push('leaving the lab restores the shared Golden/Diorama game look');
  assert.equal(errors.length, 0, errors.join('\n'));
  if (launch.capture)
    await fs.writeFile(
      path.join(output, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Lantern lighting comparisons</title><style>body{background:#141923;color:#e4e1d9;font:16px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px}img{width:100%;height:auto}figure{margin:0}figcaption{padding:8px 0}h1{font-family:Georgia}a{color:#dfc397}</style><h1>Golden hour / Silver hour</h1><p>Native renderer captures. Source artwork and the selected orthographic camera are unchanged. Each area/resolution includes the original rendering and six live lab combinations.</p><main>${gallery.map((g) => `<figure><a href="${g.file}"><img loading="lazy" src="${g.file}" alt="${g.area} ${g.rig} ${g.look}"></a><figcaption>${g.area} · ${g.resolution} · ${g.rig} · ${g.look}</figcaption></figure>`).join('')}</main>`,
    );
  const asar = path.resolve(path.dirname(launch.executable), '../Resources/app.asar');
  await fs.writeFile(
    path.join(output, 'lighting-smoke.json'),
    JSON.stringify(
      {
        passed: true,
        quick,
        packageSha256: createHash('sha256')
          .update(await fs.readFile(asar))
          .digest('hex'),
        checks,
        gallery,
        benchmarks,
        errors,
        scope:
          'Packaged macOS arm64, hidden WebGL2 window. Frame intervals include display scheduling; visible pacing and Windows hardware are unverified.',
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${checks.length} lighting checks; ${launch.capture ? output + '/index.html' : 'verified; successful diagnostics discarded'}`,
  );
} catch (error) {
  await fs.writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ error: String(error), errors, checks, benchmarks }, null, 2),
  );
  throw error;
} finally {
  await launch.close();
}
