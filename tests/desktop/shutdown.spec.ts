import { test, expect, _electron } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { electronConfig } from '../../tools/build-electron';
import { parseSettings } from '../../src/platform/settings';
import { defaultVisualEffects } from '../../src/content/visual-effects';

test('window close and application quit finish an admitted atomic save', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-shutdown-'));
  try {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(
      path.join(root, 'dist/index.html'),
      '<!doctype html><title>Shutdown</title>',
    );
    for (const name of ['main', 'preload'] as const)
      await build({ ...electronConfig(name, 'game'), outfile: path.join(root, `${name}.cjs`) });
    const settings = parseSettings({
      version: 5,
      renderScale: 0.5,
      showDebug: false,
      verticalSpan: 9,
      depthOfField: 0,
      visualEffects: defaultVisualEffects(),
    });
    for (const method of ['window', 'application'] as const) {
      const profile = path.join(root, method),
        file = path.join(profile, 'prototype-saves/settings.json'),
        application = await _electron.launch({
          args: [
            path.join(root, 'main.cjs'),
            // Raw Electron fixtures share AppKit's bundle identity. Ignore its
            // crash-restoration prompt per launch, preserving the user's state.
            ...(process.platform === 'darwin' ? ['-ApplePersistenceIgnoreState', 'YES'] : []),
          ],
          cwd: root,
          env: {
            ...process.env,
            LANTERN_DEV_URL: '',
            LANTERN_USER_DATA: profile,
            LANTERN_TEST_HIDDEN: '1',
            LANTERN_AUTOMATED_RUN: '1',
          },
        });
      try {
        const child = application.process();
        const page = await application.firstWindow();
        await page.waitForLoadState();
        await application.evaluate(
          ({ app, BrowserWindow }, { method, file }) => {
            const storage = process.getBuiltinModule('fs').promises,
              rename = storage.rename;
            storage.rename = async (...args) => {
              if (args[1] === file) {
                if (method === 'window') BrowserWindow.getAllWindows()[0]!.close();
                else app.quit();
                // Closing at the settings replacement boundary must retain the
                // host through its write. Diagnostic writes cannot trigger it.
                await new Promise<void>((resolve) => setTimeout(resolve, 150));
              }
              return rename(...args);
            };
          },
          { method, file },
        );
        const closed = application.waitForEvent('close');
        try {
          await page.evaluate((value) => {
            void window.lantern!.saveSettings(value).catch(() => {});
          }, settings);
        } catch (error) {
          // Renderer destruction can precede the evaluation acknowledgment.
          if (
            !(error instanceof Error) ||
            !error.message.includes('Target page, context or browser has been closed')
          )
            throw error;
        }
        await closed;
        expect(child.exitCode).toBe(0);
        expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(settings);
        expect(await fs.readdir(path.dirname(file))).toEqual(['settings.json']);
      } finally {
        await application.close().catch(() => {});
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
