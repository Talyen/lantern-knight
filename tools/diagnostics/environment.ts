import os from 'node:os';
import { option, type smokeLaunch } from '../smoke/smoke-launch';

export async function desktopEnvironment(
  run: Pick<Awaited<ReturnType<typeof smokeLaunch>>, 'app' | 'flags' | 'launchArgs'>,
) {
  const desktop = await run.app.evaluate(({ BrowserWindow, screen }, launchArgs) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    return {
      arch: process.arch,
      refreshHz: screen.getDisplayMatching(window.getBounds()).displayFrequency,
      visible: window.isVisible(),
      runtime: {
        node: process.versions.node!,
        electron: process.versions.electron!,
        chromium: process.versions.chrome!,
      },
      flags: launchArgs.filter((arg) => /^--(?:use-|disable-gpu)/.test(arg)),
    };
  }, run.launchArgs);
  return {
    ...desktop,
    hardware: option(
      '--hardware',
      os.hostname() + ' / ' + (os.cpus()[0]?.model ?? 'unknown CPU'),
      run.flags,
    ),
    os: `${os.platform()} ${os.release()}`,
  };
}
