import { test, expect, _electron } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { electronConfig } from '../../tools/build-electron';

test('native diagnostics export records renderer failure and drains before restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-diagnostic-export-'));
  try {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(
      path.join(root, 'dist/index.html'),
      '<!doctype html><title>Diagnostics</title>',
    );
    for (const name of ['main', 'preload'] as const)
      await build({ ...electronConfig(name, 'game'), outfile: path.join(root, `${name}.cjs`) });
    const profile = path.join(root, 'profile'),
      output = path.join(root, 'export.json');
    const application = await _electron.launch({
      args: [path.join(root, 'main.cjs')],
      cwd: root,
      env: {
        ...process.env,
        LANTERN_DEV_URL: '',
        LANTERN_USER_DATA: profile,
        LANTERN_TEST_HIDDEN: '1',
        LANTERN_AUTOMATED_RUN: '1',
      },
    });
    const child = application.process();
    try {
      const page = await application.firstWindow();
      await page.waitForLoadState();
      await page.evaluate(() => console.error('Diagnostic fixture error'));
      await application.evaluate(({ app, dialog }, output) => {
        // Exercise the real crash/export/restart path without a modal or a second process.
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
        app.relaunch = () => {};
      }, output);
      const closed = application.waitForEvent('close');
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.forcefullyCrashRenderer(),
      );
      await closed;
      const report = JSON.parse(await fs.readFile(output, 'utf8'));
      expect(
        report.current.events.some(
          (event: { kind: string; detail: string }) =>
            event.kind === 'renderer-error' && event.detail === 'Diagnostic fixture error',
        ),
      ).toBe(true);
      expect(
        report.current.events.some((event: { kind: string }) => event.kind === 'renderer-gone'),
      ).toBe(true);
      expect(report.current.environment.platform).toBe(process.platform);
      expect(
        JSON.parse(await fs.readFile(path.join(profile, 'diagnostics/session.json'), 'utf8'))
          .events,
      ).toEqual(report.current.events);
      expect(child.exitCode).toBe(0);
    } finally {
      await application.close().catch(() => {});
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
