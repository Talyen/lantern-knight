import { test, expect, _electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyBuildIdentity } from '../../tools/build-identity';
import { smokeExecutable } from '../../tools/smoke/smoke-launch';
import { extractFile } from '@electron/asar';
test('Game package starts, accepts input and reloads current storage', async () => {
  await verifyBuildIdentity();
  const executable = smokeExecutable(false),
    profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-desktop-'));
  const archive =
    process.platform === 'darwin'
      ? path.resolve(path.dirname(executable), '../Resources/app.asar')
      : path.join(path.dirname(executable), 'resources/app.asar');
  expect(JSON.parse(extractFile(archive, 'dist/build-identity.json').toString())).toEqual(
    JSON.parse(await fs.readFile('dist/build-identity.json', 'utf8')),
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
    );
    expect(await page.evaluate(() => 'foundation' in window)).toBe(false);
    expect(await page.evaluate(() => typeof window.lantern?.launchMode)).toBe('undefined');
    await page.locator('#pause').click();
    await page.locator('#render-scale').selectOption('0.5');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
    const initial = JSON.parse(
      await fs.readFile(path.join(profile, 'prototype-saves/game.json'), 'utf8'),
    );
    await page.locator('#resume').click();
    await page.locator('canvas').focus();
    await page.keyboard.down('KeyW');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let count = 0;
          const frame = () => {
            if (++count === 10) resolve();
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }),
    );
    await page.keyboard.up('KeyW');
    await page.locator('#pause').click();
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('saved', { ignoreCase: true });
    const moved = JSON.parse(
      await fs.readFile(path.join(profile, 'prototype-saves/game.json'), 'utf8'),
    );
    expect(
      Math.hypot(moved.player.x - initial.player.x, moved.player.z - initial.player.z),
    ).toBeGreaterThan(0.03);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.waitForFunction(
      () => document.querySelector('canvas')?.getAttribute('data-ready') === 'true',
    );
    await page.locator('#pause').click();
    await page.locator('#load').click();
    await expect(page.locator('#status')).toContainText('loaded', { ignoreCase: true });
  } finally {
    await app.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
});
