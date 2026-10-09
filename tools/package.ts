import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildDesktop } from './build';
import { buildIdentity } from './build-identity';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
async function packageApp(platform: 'mac' | 'win', dev = false, prebuilt = false, local = false) {
  if (prebuilt && local)
    throw new Error('--local cannot select assets for an existing package build');
  if (!prebuilt) await buildDesktop(dev, local);
  await buildIdentity({ dev });
  await runProcess(
    process.execPath,
    [
      'node_modules/electron-builder/cli.js',
      ...(dev ? ['--config', 'electron-builder.dev.json'] : []),
      '--' + platform,
      platform === 'mac' ? '--arm64' : '--x64',
      '--dir',
    ],
    { cwd: projectRoot, timeoutMs: 10 * 60_000 },
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      dev: { type: 'boolean' },
      prebuilt: { type: 'boolean' },
      local: { type: 'boolean' },
    },
  });
  const platform =
    values.platform ??
    (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : undefined);
  if (platform !== 'mac' && platform !== 'win') throw new Error('Supply --platform mac|win');
  packageApp(platform, values.dev, values.prebuilt, values.local).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
