// Disposable Chromium host for the live Vite preview; no build or player Bridge.
const { app, BrowserWindow, session } = require('electron');
const [url, profile] = process.argv.slice(2);
const port = process.env.LANTERN_PREVIEW_PORT ?? '5174';
let preview;
try {
  preview = new URL(url);
} catch {}
if (
  !/^[1-9]\d{0,4}$/.test(port) ||
  Number(port) > 65535 ||
  !preview ||
  preview.protocol !== 'http:' ||
  preview.hostname !== '127.0.0.1' ||
  (preview.port || '80') !== port ||
  preview.username ||
  preview.password ||
  !['/sandbox.html', '/editor.html'].includes(preview.pathname) ||
  !profile
)
  throw new Error('Expected the assigned local scene preview port and an isolated profile.');
app.setPath('userData', profile);
app.enableSandbox();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    width: 2560,
    height: 1600,
    useContentSize: true,
    show: false,
    focusable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
