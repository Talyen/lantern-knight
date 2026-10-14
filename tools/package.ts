import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildDesktop } from './build-workflow';
import { verifyBuildIdentity } from './build-identity';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { macSigning, prepareMacSigning, notarizeMacApp } from './package-mac';
async function packageApp(
  platform: 'mac' | 'win',
  profile: import('./build-profile').BuildProfile = 'game',
  prebuilt = false,
  local = false,
  signing?: ReturnType<typeof macSigning>,
) {
  if (prebuilt && local)
    throw new Error('--local cannot select assets for an existing package build');
  if (signing) await prepareMacSigning(signing, projectRoot);
  if (!prebuilt) await buildDesktop(profile, local);
  await verifyBuildIdentity({ profile });
  await runProcess(
    process.execPath,
    [
      'node_modules/electron-builder/cli.js',
      ...(profile === 'authoring' ? ['--config', 'electron-builder.dev.json'] : []),
      '--' + platform,
      platform === 'mac' ? '--arm64' : '--x64',
      '--dir',
      ...(signing
        ? [
            '-c.mac.identity=' + signing.identity.replace(/^Developer ID Application: /, ''),
            '-c.mac.type=distribution',
            '-c.forceCodeSigning=true',
            '-c.mac.hardenedRuntime=true',
            '-c.mac.entitlements=electron/entitlements.mac.plist',
            '-c.mac.entitlementsInherit=electron/entitlements.mac.plist',
            '-c.mac.notarize=false',
          ]
        : []),
    ],
    { cwd: projectRoot, timeoutMs: 10 * 60_000 },
  );
  if (signing) await notarizeMacApp(signing, projectRoot);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      dev: { type: 'boolean' },
      prebuilt: { type: 'boolean' },
      local: { type: 'boolean' },
      signed: { type: 'boolean' },
      identity: { type: 'string' },
      'notary-profile': { type: 'string' },
    },
  });
  const platform =
    values.platform ??
    (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : undefined);
  if (platform !== 'mac' && platform !== 'win') throw new Error('Supply --platform mac|win');
  const signing = macSigning({ ...values, platform });
  packageApp(
    platform,
    values.dev ? 'authoring' : 'game',
    values.prebuilt,
    values.local,
    signing,
  ).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
