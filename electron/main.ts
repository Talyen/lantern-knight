import { app, BrowserWindow, ipcMain, net, protocol, session, powerMonitor, Menu } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchEntry, checkpointDirectory } from './launch';
import { Store } from './store';
import { DesktopSession } from './session';
import { DesktopShutdown } from './shutdown';
import { content } from '../src/content/game-content';
import { resourcePath, trustedSender } from './security';
declare const __DEV_APP__: boolean;
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lantern',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);
const developmentOrigin = app.isPackaged ? undefined : process.env.LANTERN_DEV_URL;
const developer = __DEV_APP__ || !!developmentOrigin;
if (developer) app.setPath('userData', path.join(app.getPath('appData'), 'Lantern Knight Dev'));
if (process.env.LANTERN_USER_DATA)
  app.setPath('userData', path.resolve(process.env.LANTERN_USER_DATA)); // app-owned test harness only; never renderer-selected
app.enableSandbox();
if (developmentOrigin) {
  const url = new URL(developmentOrigin);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Expected an assigned local Vite origin');
}
const pageURL = (entry: string) =>
  developmentOrigin ? `${developmentOrigin}/${entry}` : `lantern://app/${entry}`;
const hiddenTest = process.env.LANTERN_TEST_HIDDEN === '1';
const automatedRun = process.env.LANTERN_AUTOMATED_RUN === '1';
let window: BrowserWindow | undefined;
let desktop: DesktopSession | undefined;
let exitCode = 0;
const shutdown = new DesktopShutdown(
  () => desktop?.dispose() ?? Promise.resolve(),
  () => {
    if (exitCode) app.exit(exitCode);
    else app.quit();
  },
);
app.on('before-quit', (event) => shutdown.request(event));
app
  .whenReady()
  .then(async () => {
    if (shutdown.requested) return;
    if (hiddenTest && process.platform === 'darwin') app.setActivationPolicy('accessory');
    Menu.setApplicationMenu(null);
    const applicationRoot = app.isPackaged ? app.getAppPath() : process.cwd();
    const root = path.join(applicationRoot, __DEV_APP__ ? 'dist-dev' : 'dist');
    protocol.handle('lantern', async (request) => {
      try {
        if (request.method !== 'GET') return new Response('method denied', { status: 405 });
        return await net.fetch(pathToFileURL(resourcePath(request.url, root)).toString());
      } catch {
        return new Response('resource denied', { status: 403 });
      }
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const mode: 'game' | 'sandbox' | 'effects' | 'editor' =
      __DEV_APP__ && process.argv.includes('--editor')
        ? 'editor'
        : __DEV_APP__ && process.argv.includes('--effects')
          ? 'effects'
          : __DEV_APP__ && !process.argv.includes('--game')
            ? 'sandbox'
            : 'game';
    const profileRoot = app.getPath('userData');
    const storeFor = (selected: 'game' | 'sandbox' | 'effects' | 'editor') =>
      new Store(checkpointDirectory(profileRoot, developer, selected), content);
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: !hiddenTest,
      focusable: !hiddenTest,
      enableLargerThanScreen: true,
      backgroundColor: '#151923',
      title: developer ? 'Lantern Knight Dev' : 'Lantern Knight',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        backgroundThrottling: !hiddenTest && !automatedRun,
        additionalArguments: automatedRun ? ['--lantern-automated-run'] : [],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const desktopSession = new DesktopSession(mode, storeFor, async (selected) => {
      if (!window) throw new Error('Desktop window closed');
      await window.loadURL(pageURL(launchEntry(__DEV_APP__, selected)));
    });
    desktop = desktopSession;
    const entry = () => launchEntry(__DEV_APP__, desktopSession.mode);
    window.on('closed', () => {
      desktopSession.dispose().catch((error: unknown) => {
        console.error('Unable to drain the closed desktop session:', error);
      });
      window = undefined;
    });
    window.on('blur', () => {
      window?.webContents
        .executeJavaScript('window.dispatchEvent(new Event("blur"))')
        .catch(() => {});
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (!developmentOrigin || url !== pageURL(entry())) event.preventDefault();
    });
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    for (const [channel, slot, write] of [
      ['load-settings', 'settings', false],
      ['save-settings', 'settings', true],
      ['load-game', 'game', false],
      ['save-game', 'game', true],
    ] as const)
      ipcMain.handle(channel, (event, value) => {
        if (
          !window ||
          !event.senderFrame ||
          !trustedSender(
            event.senderFrame.url,
            event.senderFrame === event.sender.mainFrame,
            event.sender.id,
            window.webContents.id,
            entry(),
            developmentOrigin,
          )
        )
          throw new Error('untrusted IPC sender');
        if (!write && value !== undefined) throw new Error('load takes no payload');
        return write ? desktopSession.save(slot, value) : desktopSession.load(slot);
      });
    powerMonitor.on('suspend', () => {
      window?.webContents
        .executeJavaScript('window.dispatchEvent(new Event("blur"))')
        .catch(() => {});
    });
    if (__DEV_APP__)
      ipcMain.handle('launch-mode', async (event, next) => {
        if (
          !window ||
          !event.senderFrame ||
          !trustedSender(
            event.senderFrame.url,
            event.senderFrame === event.sender.mainFrame,
            event.sender.id,
            window.webContents.id,
            entry(),
            developmentOrigin,
          ) ||
          !['game', 'sandbox', 'effects', 'editor'].includes(next)
        )
          throw new Error('invalid development launch');
        await desktopSession.launch(next);
      });
    await desktopSession.launch(mode);
  })
  .catch((error) => {
    if (desktop?.disposed) return;
    console.error('Unable to start Lantern Knight:', error);
    exitCode = 1;
    app.quit();
  });
app.on('window-all-closed', () => app.quit());
