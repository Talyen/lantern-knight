import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../cli';
import { writeJson } from '../json-file';
import { smokeLaunch, playerControls, option } from '../smoke/smoke-launch';
import { withDiagnostic } from '../smoke/scenario';
import { requireGameBenchmarkPackage } from './game-benchmark';
import { desktopEnvironment } from './environment';
import { collectVisibleLoot } from '../smoke/collect-loot';
import { pacingAcceptance } from './pacing-model';
import { installJourneyRecorder, readJourneyRecorder } from './journey-recorder';
import { sourceInputHash } from '../source-identity';
import { content } from '../../src/content/game-content';
import { GameSession } from '../../src/core/session';
import { parseGame, type GameSave } from '../../src/core/save';
import type { Point } from '../../src/content/world';

// Checkpoint positioning isolates UI and transition work from combat/navigation.
// Encounter performance is measured separately by pacing-benchmark.
async function journey(flags: string[]) {
  assert.ok(
    flags.includes('--visible') && flags.includes('--output'),
    'Use --visible and an external --output',
  );
  const soakMs = Number(option('--soak-ms', '0', flags));
  assert.ok(Number.isFinite(soakMs) && soakMs >= 0 && soakMs <= 900000, 'Use 0–900000 ms soak');
  const harnessFiles = [
    'tools/diagnostics/pacing-journey.ts',
    'tools/diagnostics/journey-recorder.ts',
    'tools/diagnostics/pacing-model.ts',
    'tools/smoke/collect-loot.ts',
    'tools/smoke/smoke-launch.ts',
    'tools/smoke/scenario.ts',
  ];
  const harness = { sha256: await sourceInputHash(process.cwd(), { files: harnessFiles }) };
  const run = await smokeLaunch(
    false,
    process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : [],
    {
      flags,
      retain: true,
      startupTimeoutMs: 60000,
      budget: 128 * 1024 ** 2,
      laneWaitMs: 30 * 60_000,
    },
  );
  await withDiagnostic(run, async () => {
    const build = await requireGameBenchmarkPackage(run);
    const { page } = run,
      controls = playerControls(page, run.profile);
    await run.app.evaluate(({ BrowserWindow, screen, app }) => {
      const w = BrowserWindow.getAllWindows()[0]!,
        d = screen.getDisplayMatching(w.getBounds());
      w.setContentSize(d.bounds.width, d.bounds.height);
      w.show();
      if (process.platform === 'darwin') w.setSimpleFullScreen(true);
      else w.setFullScreen(true);
      app.focus({ steal: true });
      w.focus();
    });
    await page.bringToFront();
    await page.evaluate(() => Reflect.set(window, '__name', (fn: Function) => fn));
    await controls.resume();
    const checks: string[] = [],
      records: ({ phase: string } & ReturnType<typeof readJourneyRecorder>)[] = [];
    const sample = async (phase: string, work: () => Promise<void>) => {
      await page.evaluate(installJourneyRecorder, phase === 'arrival-actions');
      await work();
      await page.waitForTimeout(600);
      const result = await page.evaluate(readJourneyRecorder);
      assert.equal(result.foreground, true, 'Journey lost foreground focus');
      assert.equal(result.overflow, false, 'Journey recording exceeded its bounded budget');
      records.push({ phase, ...result });
    };
    let carried = parseGame(await controls.save(), content);
    const restore = async (save: GameSave) => {
      await controls.pause();
      await fs.writeFile(
        path.join(run.profile, 'prototype-saves/game.json'),
        JSON.stringify(parseGame(save, content)),
      );
      await page.locator('#load').click();
      await page.waitForFunction(
        () =>
          document.querySelector('#status')?.textContent === 'Checkpoint loaded' &&
          !document.body.classList.contains('traveling'),
      );
    };
    const position = async (areaId: string, point: Point, clear = true) => {
      const s = new GameSession(content, 142, areaId),
        area = content.area(areaId),
        seed = s.captureSave();
      seed.adventure = structuredClone(carried.adventure);
      seed.areas = { ...seed.areas, ...structuredClone(carried.areas) };
      seed.player = { ...seed.player, x: point.x, z: point.z };
      if (clear) {
        for (const a of Object.values(seed.areas[area.id]!.actors)) a.health = 0;
        seed.areas[area.id]!.cleared = true;
      }
      await restore(seed);
    };
    const collect = async (areaId: string, id: string) => {
      const object = content.area(areaId).interactables!.find((o) => o.id === id)!;
      await position(areaId, object);
      await sample('loot', async () => {
        await page.keyboard.press('KeyE');
        assert.ok((await collectVisibleLoot(page)) > 0);
        await page.keyboard.press('Escape');
      });
      carried = parseGame(await controls.save(), content);
      assert.ok(carried.areas[areaId]!.claimedObjects?.includes(id));
      checks.push('collected ' + id);
    };
    await collect('abandoned-orchard', 'southern-cache');
    await controls.resume();
    await sample('inventory', async () => {
      await page.locator('#open-inventory').click();
      await page.locator('.inventory-row').filter({ hasText: 'Traveller’s Charm' }).press('Enter');
      await page.getByRole('button', { name: 'Equip', exact: true }).press('Enter');
      await page.keyboard.press('Escape');
    });
    carried = parseGame(await controls.save(), content);
    assert.equal(carried.adventure!.equipment.trinket, 'travellers-charm');
    checks.push('equipped charm');
    const route = [
      'forest-gathering-clearing',
      'ruined-forge',
      'desecrated-chapel',
      'ruined-forge',
      'forest-gathering-clearing',
      'abandoned-orchard',
    ];
    const cdp = await page.context().newCDPSession(page);
    const resources: { loop: number; heap: unknown; processes: unknown }[] = [];
    let areaId = 'abandoned-orchard',
      loops = 0,
      activeMs = 0;
    const began = performance.now();
    do {
      for (const destination of route) {
        const exit = content.area(areaId).exits.find((e) => e.destination === destination)!;
        await position(areaId, exit.marker);
        // Loading is timed independently; the first resumed frame/actions belong
        // to this phase, with no warmup masking first-use work.
        await sample('arrival-actions', async () => {
          await page.keyboard.press('KeyE');
          await page.waitForFunction(
            (name) =>
              document.querySelector('#room-title')?.textContent === name &&
              !document.body.classList.contains('traveling'),
            content.area(destination).name,
            { timeout: 120000 },
          );
          // The first loop proves all interactions. Subsequent cleared-area
          // loops sustain actual movement/effects; loading never fills the
          // requested fifteen-minute gameplay budget.
          for (let step = 0; step < (soakMs > 0 && loops > 0 ? 20 : 1); step++) {
            const key = ['KeyA', 'KeyW', 'KeyD', 'KeyS'][step % 4]!;
            await page.keyboard.down(key);
            await page.keyboard.press('Shift');
            await page.mouse.click(600, 400, { button: 'right' });
            await page.mouse.click(650, 420);
            await page.waitForTimeout(1000);
            await page.keyboard.up(key);
          }
        });
        activeMs += records.at(-1)!.frames.reduce((sum, ms) => sum + ms, 0);
        carried = parseGame(await controls.save(), content);
        assert.equal(carried.area, destination);
        checks.push(areaId + ' → ' + destination);
        areaId = destination;
        if (destination === 'ruined-forge' && loops === 0 && !carried.adventure!.forgeUpgrade) {
          await collect(areaId, 'forge-tool-chest');
          const bench = content.area(areaId).interactables!.find((o) => o.kind === 'workbench')!;
          await position(areaId, bench);
          await sample('forge', async () => {
            await page.keyboard.press('KeyE');
            await page.getByRole('button', { name: 'Temper Sword', exact: true }).press('Enter');
            await page.getByRole('button', { name: 'Confirm upgrade', exact: true }).press('Enter');
            await page.waitForFunction(
              () => document.querySelector('.forge-decision button')?.textContent === 'Complete',
            );
            await page.keyboard.press('Escape');
          });
          carried = parseGame(await controls.save(), content);
          assert.equal(carried.adventure!.forgeUpgrade, 'sword');
          assert.equal(carried.adventure!.equipment.trinket, 'travellers-charm');
          assert.ok(carried.areas['ruined-forge']!.claimedObjects?.includes('forge-tool-chest'));
          checks.push('forge purchase persisted');
        }
        if (destination === 'desecrated-chapel' && loops === 0) {
          const fire = content.area(areaId).campfires![0]!;
          await position(areaId, fire);
          await sample('rest', async () => {
            await page.keyboard.press('KeyE');
            await page.getByRole('button', { name: 'Rest', exact: true }).press('Enter');
            await page.waitForFunction(
              () => document.querySelector('#status')?.textContent === 'Rested · health restored',
            );
            await page.keyboard.press('Escape');
          });
          carried = parseGame(await controls.save(), content);
          const dead = structuredClone(carried);
          dead.player.health = 0;
          await restore(dead);
          await page.waitForFunction(
            () =>
              Number(document.querySelector('#hp')?.textContent?.split('/')[0]?.trim()) > 0 &&
              !document.body.classList.contains('traveling'),
          );
          carried = parseGame(await controls.save(), content);
          assert.ok(carried.player.health > 0);
          assert.equal(carried.adventure!.forgeUpgrade, 'sword');
          checks.push('rest, death and retry preserved equipment/upgrade');
          assert.equal(carried.adventure!.equipment.trinket, 'travellers-charm');
          assert.ok(carried.areas['ruined-forge']!.claimedObjects?.includes('forge-tool-chest'));
        }
        if (run.capture && loops === 0) {
          await controls.resume();
          await page.screenshot({ path: path.join(run.output, `${loops}-${destination}.png`) });
        }
      }
      loops++;
      resources.push({
        loop: loops,
        heap: await cdp.send('Runtime.getHeapUsage'),
        processes: await run.app.evaluate(({ app }) =>
          app.getAppMetrics().map((m) => ({ type: m.type, memory: m.memory })),
        ),
      });
    } while (activeMs < soakMs);
    const environment = {
      ...(await desktopEnvironment(run)),
      ...(await page.evaluate(() => {
        const canvas = document.querySelector('canvas')!,
          gl = canvas.getContext('webgl2')!,
          info = gl.getExtension('WEBGL_debug_renderer_info');
        return {
          buffer: [canvas.width, canvas.height],
          gpu: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
          renderScale: (document.querySelector('#render-scale') as HTMLSelectElement).value,
        };
      })),
    };
    assert.doesNotMatch(environment.gpu, /swiftshader|llvmpipe|software|unavailable/i);
    assert.equal(environment.renderScale, '1');
    await requireGameBenchmarkPackage(run);
    assert.equal(
      await sourceInputHash(process.cwd(), { files: harnessFiles }),
      harness.sha256,
      'Journey harness changed during measurement',
    );
    await writeJson(path.join(run.output, 'journey.json'), {
      build,
      harness,
      environment,
      checks,
      loops,
      activeMs,
      resources,
      elapsedMs: performance.now() - began,
      records: records.map((r) => ({
        ...r,
        summary: r.frames.length >= 30 ? pacingAcceptance(r.frames, environment.refreshHz) : null,
      })),
      limitations: [
        'Checkpoint-assisted positions and cleared encounters isolate UI and room lifetime. Combat pacing is a separate diagnostic. Loading durations are excluded from active frame claims.',
      ],
    });
    console.log(
      `Journey: ${checks.length} completed checks, ${loops} linked loops; ${Math.round(activeMs / 1000)} active seconds, ${Math.round((performance.now() - began) / 1000)} seconds total.`,
    );
  });
}
runCli(import.meta.url, () => journey(process.argv.slice(2)), 'message');
