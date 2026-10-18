import { readJson } from '../../tools/json-file';
import { holdMovement, loadCheckpoint } from '../fixtures/input';
import { test, expect, _electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyBuildIdentity } from '../../tools/build-identity';
import { smokeExecutable, playerControls } from '../../tools/smoke/smoke-launch';
import { extractFile } from '@electron/asar';
test('Game package starts, accepts input and reloads current storage', async () => {
  // Two cold launches decode and prepare the complete current player kit.
  test.setTimeout(300_000);
  await verifyBuildIdentity();
  const executable = smokeExecutable(false),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-desktop-'));
  const archive =
    process.platform === 'darwin'
      ? path.resolve(path.dirname(executable), '../Resources/app.asar')
      : path.join(path.dirname(executable), 'resources/app.asar');
  expect(JSON.parse(extractFile(archive, 'dist/build-identity.json').toString())).toEqual(
    await readJson('dist/build-identity.json'),
  );
  const launch = () =>
    _electron.launch({
      executablePath: executable,
      env: {
        ...process.env,
        LANTERN_USER_DATA: profile,
        LANTERN_AUTOMATED_RUN: '1',
        LANTERN_TEST_HIDDEN: '1',
      },
      args: process.platform === 'win32' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await page.waitForFunction(
      () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
      undefined,
      { timeout: 120_000 },
    );
    expect(await page.evaluate(() => 'foundation' in window)).toBe(false);
    expect(await page.evaluate(() => typeof window.lantern?.launchMode)).toBe('undefined');
    await expect(page.locator('#menu-start')).toHaveAccessibleName('Begin journey');
    await page.locator('#menu-start').click();
    const { save } = playerControls(page, profile);
    await page.locator('#pause').click();
    await page.locator('#menu-settings').click();
    await page.locator('#render-scale').selectOption('0.5');
    await page.locator('#menu-back').click();
    const initial = await save();
    await page.locator('#resume').click();
    await holdMovement(page, 'KeyW');
    const moved = await save();
    expect(
      Math.hypot(moved.player.x - initial.player.x, moved.player.z - initial.player.z),
    ).toBeGreaterThan(0.03);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.waitForFunction(
      () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
      undefined,
      { timeout: 120_000 },
    );
    await expect(page.locator('#menu-start')).toHaveAccessibleName('Continue journey');
    await page.locator('#menu-start').click();
    await page.locator('#pause').click();
    await loadCheckpoint(page);
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
