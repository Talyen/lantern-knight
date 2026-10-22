import { app, crashReporter, dialog, Menu, type BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiagnosticLog, crashDumps, readBounded, type DiagnosticIdentity } from './diagnostic-log';

export async function openDiagnostics(root: string) {
  let identity: DiagnosticIdentity = {};
  try {
    const value = JSON.parse(
      (await readBounded(path.join(root, 'build-identity.json'), 4 * 1024 ** 2)).toString(),
    );
    const hash = (value: unknown) =>
      typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value) ? value : undefined;
    identity = {
      sourceCommit: hash(value.sourceCommit),
      inputSha256: hash(value.inputSha256),
      assetSha256: hash(value.assets?.sha256),
    };
  } catch {
    // Live development and startup failures may have no build identity.
  }
  const log = new DiagnosticLog(path.join(app.getPath('userData'), 'diagnostics'), identity);
  const dumpDirectory = app.getPath('crashDumps');
  crashReporter.start({ uploadToServer: false, compress: true });
  log.record('launch', 'Application started');
  const environment = {
    platform: process.platform,
    architecture: process.arch,
    os: process.getSystemVersion(),
    app: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  };
  log.setEnvironment(environment);
  void app
    .getGPUInfo('basic')
    .then((info) => {
      const gpu = info as {
        gpuDevice?: {
          active?: boolean;
          vendorId?: number;
          deviceId?: number;
          driverVersion?: string;
        }[];
        auxAttributes?: { glRenderer?: string; driverVersion?: string };
      };
      log.setEnvironment({
        ...environment,
        gpu: JSON.stringify(
          gpu.gpuDevice
            ?.slice(0, 2)
            .map(({ active, vendorId, deviceId }) => ({ active, vendorId, deviceId })) ?? [],
        ),
        renderer: gpu.auxAttributes?.glRenderer ?? 'unavailable',
        driver:
          gpu.gpuDevice?.find((device) => device.active)?.driverVersion ??
          gpu.auxAttributes?.driverVersion ??
          'unavailable',
        graphics: JSON.stringify(app.getGPUFeatureStatus()),
      });
    })
    .catch((error: unknown) => log.record('gpu-info-error', String(error)));
  void crashDumps(dumpDirectory).catch((error: unknown) =>
    log.record('dump-retention-error', String(error)),
  );
  let exporting = false;
  let closed = false;
  let exportWrite: Promise<void> | undefined;
  const exportReport = async () => {
    if (exporting || closed) return;
    exporting = true;
    try {
      const selection = await dialog.showSaveDialog({
        title: 'Export diagnostics',
        defaultPath: 'Lantern Knight diagnostics.json',
        message:
          'Includes system information, recent errors and crash memory dumps. Review before sharing.',
        filters: [{ name: 'Diagnostic report', extensions: ['json'] }],
      });
      if (selection.canceled || !selection.filePath || closed) return;
      const destination = selection.filePath;
      exportWrite = (async () => {
        const report = { ...(await log.snapshot()), crashDumps: await crashDumps(dumpDirectory) };
        const temporary = destination + '.' + randomUUID() + '.tmp';
        try {
          await fs.writeFile(temporary, JSON.stringify(report, null, 2), {
            mode: 0o600,
            flag: 'wx',
          });
          await fs.rename(temporary, destination);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      })();
      await exportWrite;
    } catch (error) {
      log.record('export-error', String(error));
      if (!closed) dialog.showErrorBox('Unable to export diagnostics', String(error));
    } finally {
      exporting = false;
    }
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      {
        label: 'Help',
        submenu: [
          {
            id: 'export-diagnostics',
            label: 'Export diagnostics…',
            click: () => {
              void exportReport().catch((error: unknown) =>
                log.record('export-error', String(error)),
              );
            },
          },
        ],
      },
    ]),
  );
  const childGone = (_event: Electron.Event, details: Electron.Details) =>
    log.record('child-process-gone', JSON.stringify(details));
  app.on('child-process-gone', childGone);
  const exception = (error: Error) => log.fatal(error);
  // Observe without suppressing Node's fatal exception behavior.
  process.on('uncaughtExceptionMonitor', exception);
  return {
    record: (kind: string, detail: string) => log.record(kind, detail),
    watch(window: BrowserWindow, reload: () => Promise<void>) {
      let recovering = false;
      window.on('unresponsive', () =>
        log.record('unresponsive', 'The native game window did not respond'),
      );
      window.webContents.on('console-message', (details) => {
        if (details.level === 'error' || details.level === 'warning')
          log.record('renderer-' + details.level, details.message);
      });
      window.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
        if (mainFrame && code !== -3) log.record('load-failed', code + ': ' + description);
      });
      window.webContents.on('render-process-gone', (_event, details) => {
        log.record('renderer-gone', JSON.stringify(details));
        if (recovering || closed || window.isDestroyed()) return;
        recovering = true;
        void (async () => {
          try {
            const { response } = await dialog.showMessageBox(window, {
              type: 'error',
              title: 'The game stopped responding',
              message: 'The game window stopped unexpectedly.',
              detail:
                'Restart from your last saved checkpoint, or export diagnostics to help investigate.',
              buttons: ['Restart', 'Export and restart', 'Quit'],
              defaultId: 0,
              cancelId: 2,
            });
            if (closed) return;
            if (response === 1) await exportReport();
            if (response === 2) app.quit();
            else if (!closed && !window.isDestroyed()) await reload();
          } catch (error) {
            log.record('recovery-error', String(error));
            app.quit();
          } finally {
            recovering = false;
          }
        })().catch((error: unknown) => log.record('recovery-error', String(error)));
      });
    },
    async close() {
      closed = true;
      app.off('child-process-gone', childGone);
      process.off('uncaughtExceptionMonitor', exception);
      await exportWrite?.catch(() => {});
      await log.close();
    },
  };
}
