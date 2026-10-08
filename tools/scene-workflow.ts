import { sceneFixture } from './scene-fixtures';
import {
  traverseScene,
  checkForeground,
  checkSurround,
  checkRoomLifetime,
  checkPreviewReload,
  captureScene,
  benchmarkSurround,
} from './scene-scenarios';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { _electron, type ElectronApplication } from 'playwright';
import { fileURLToPath } from 'node:url';
import { sandboxContent } from '../src/content/sandbox-world';
import { worldVisuals } from '../src/content/world-art';
import { isSupportedPosition } from '../src/content/world';
import { validateConstruction } from '../src/presentation/art-validation';
import { sceneArtFindings } from '../src/content/scene-art-validation';
import { AssetCache } from './assets/cache';
import { scenePreviewServer } from './scene-server';
import { verificationIdentity, requireStableInputs } from './verification';
import { projectRoot } from './assets/paths';
import type {} from '../src/inspection';

export function sceneOptions(args: string[]) {
  let scene: string | undefined,
    capture = false,
    local = false,
    skipReload = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scene') {
      if (scene || !args[i + 1]) throw new Error('Supply --scene <area-id> once.');
      scene = args[++i];
    } else if (args[i] === '--capture' && !capture) capture = true;
    else if (args[i] === '--local' && !local) local = true;
    else if (args[i] === '--skip-reload' && !skipReload) skipReload = true;
    else throw new Error('Unknown scene option: ' + args[i]);
  }
  if (!scene) throw new Error('Supply --scene <area-id>.');
  sandboxContent.area(scene);
  return { scene, capture, local, skipReload };
}

export async function checkScene(
  scene: string,
  capture: boolean,
  options: { benchmark?: boolean; skipReload?: boolean } = {},
) {
  const before = await verificationIdentity(projectRoot),
    started = performance.now(),
    area = sandboxContent.area(scene),
    art = worldVisuals[scene];
  if (art) {
    assert.deepEqual(validateConstruction(area, art), []);
    assert.deepEqual(sceneArtFindings(art), []);
  }
  for (const entry of area.entries)
    assert.ok(isSupportedPosition(area, entry, 0.3), 'Blocked scene entry');
  if (scene === 'upper-landing') {
    const { inspectCrypt } = await import('./check-crypt-art');
    const result = await inspectCrypt();
    assert.deepEqual(result.constructionErrors, []);
    assert.deepEqual(result.depthConflicts, []);
  }
  const fixture = sceneFixture(scene, area.entries[0]!);
  for (const point of [...fixture.route, fixture.foreground])
    assert.ok(isSupportedPosition(area, point, 0.3), 'Unsupported scene fixture position');
  let surroundCost: unknown;
  const held = await new AssetCache().lease('diagnostics-' + randomUUID(), 32 * 1024 ** 2);
  let server: Awaited<ReturnType<typeof scenePreviewServer>> | undefined,
    browser: ElectronApplication | undefined;
  const profile = path.join(held.root, 'profile');
  try {
    server = await scenePreviewServer();
    browser = await _electron.launch({
      args: [
        path.join(projectRoot, 'tools/scene-browser.cjs'),
        `${server.origin}/sandbox.html?scene=${encodeURIComponent(scene)}`,
        profile,
      ],
    });
    const page = await browser.firstWindow(),
      errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.waitForFunction(
      () => window.foundation?.ready && window.foundation.presentation.lookRenderer.ready,
      {},
      { timeout: 45000 },
    );
    assert.equal(await page.evaluate(() => window.foundation.sim.area), scene);
    const startupMs = performance.now() - started;
    const initialLook = await page.evaluate(() => ({
      ...window.foundation.presentation.lookRenderer.settings,
    }));
    const route = fixture.route,
      foreground = fixture.foreground;
    const context = {
      page,
      browser,
      scene,
      area,
      art,
      route,
      foreground,
      held,
      initialLook,
      capture,
      benchmark: options.benchmark ?? false,
    };
    await traverseScene(context);
    await checkForeground(context);
    await checkSurround(context);
    if (options.benchmark && art?.surround) surroundCost = await benchmarkSurround(context);
    await checkRoomLifetime(context);
    const reloadMs = options.skipReload ? null : await checkPreviewReload(context);
    await captureScene(context);
    assert.deepEqual(errors, []);
    await requireStableInputs(projectRoot, before);
    const report = {
      passed: true,
      scene,
      startupMs: Math.round(startupMs),
      totalMs: Math.round(performance.now() - started),
      reloadMs,
      reusedPreview: server.reused,
      surroundCost,
      scope:
        'Development browser: construction, deterministic traversal, foreground policy, surround viewport/color composition, room lifetime and preview reload. Packaged player controls and release verification are separate.',
    };
    console.log(
      `PASS: ${scene} scene acceptance; startup ${report.startupMs}ms; reload ${report.reloadMs === null ? 'reused' : report.reloadMs + 'ms'}; total ${report.totalMs}ms; ${server.reused ? 'shared' : 'temporary'} preview.`,
    );
    if (capture) {
      await fs.writeFile(path.join(held.root, 'scene.json'), JSON.stringify(report, null, 2));
      console.log('Scene captures: ' + held.root);
    }
    return { report, captureDirectories: capture ? [held.root] : [] };
  } catch (error) {
    await fs.writeFile(
      path.join(held.root, 'failure.json'),
      JSON.stringify({ scene, error: String(error) }, null, 2),
    );
    console.error('Scene failure diagnostics: ' + held.root);
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        await server?.close();
        await fs.rm(profile, { recursive: true, force: true });
        if (
          !capture &&
          !(await fs.access(path.join(held.root, 'failure.json')).then(
            () => true,
            () => false,
          ))
        )
          await fs.rm(held.root, { recursive: true, force: true });
      } finally {
        await held.release();
      }
    }
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2),
    options = sceneOptions(args);
  if (mode === 'dev') {
    const server = await scenePreviewServer(),
      url = `${server.origin}/sandbox.html?scene=${encodeURIComponent(options.scene)}`;
    console.log(`${server.reused ? 'Reusing' : 'Serving'} scene preview: ${url}`);
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer'
          : 'xdg-open';
    execFile(opener, [url], (error) => {
      if (error) console.log('Open the preview URL in your browser.');
    });
    if (server.reused) return;
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    await server.close();
  } else if (mode === 'check' || mode === 'benchmark') {
    const result = await checkScene(options.scene, options.capture, {
      benchmark: mode === 'benchmark',
      skipReload: options.skipReload,
    });
    if (process.env.LANTERN_TASK_RESULT)
      await fs.writeFile(process.env.LANTERN_TASK_RESULT, JSON.stringify(result));
  } else if (mode === 'task') await (await import('./task-runner')).managedTask('check:task', args);
  else throw new Error('Use scene:dev, scene:check or check:task.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
