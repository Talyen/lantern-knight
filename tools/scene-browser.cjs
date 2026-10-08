// Disposable Chromium host for the live Vite preview; no build or player Bridge.
const { app, BrowserWindow, session } = require('electron');
const [url, profile] = process.argv.slice(2);
if (
  !/^http:\/\/127\.0\.0\.1:5174\/(?:sandbox\.html\?|editor\.html(?:\?|$))/.test(url ?? '') ||
  !profile
)
  throw new Error('Expected a local scene preview and isolated profile.');
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
