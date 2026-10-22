import { runCli } from './cli';
import { parseArgs } from 'node:util';
import { buildDesktop } from './build-workflow';
import { verifyBuildIdentity } from './build-identity';
import { runProcess } from './run-process';
import { projectRoot } from './assets/paths';
import { macSigning, prepareMacSigning, notarizeMacApp } from './package-mac';
import { verifyPackageFuses } from './package-fuses';
import path from 'node:path';
async function packageApp(
  platform: 'mac' | 'win',
  profile: import('./build-profile').BuildProfile = 'game',
  prebuilt = false,
  local = false,
  signing?: ReturnType<typeof macSigning>,
  prebuiltWeb = false,
  inspectable = false,
) {
  if (prebuilt && prebuiltWeb) throw new Error('Choose --prebuilt or --prebuilt-web');
  if (prebuilt && local)
    throw new Error('--local cannot select assets for an existing package build');
  const releaseSigning = signing ? await prepareMacSigning(signing, projectRoot) : undefined;
  if (!prebuilt) await buildDesktop(profile, local, prebuiltWeb);
  await verifyBuildIdentity({ profile });
  await runProcess(
    process.execPath,
    [
      'node_modules/electron-builder/cli.js',
      ...(profile === 'authoring' ? ['--config', 'electron-builder.dev.json'] : []),
      '--' + platform,
      platform === 'mac' ? '--arm64' : '--x64',
      '--dir',
      ...(inspectable
        ? [
            '-c.directories.output=release-inspectable',
            '-c.electronFuses.runAsNode=true',
            '-c.electronFuses.enableNodeCliInspectArguments=true',
          ]
        : []),
      ...(releaseSigning
        ? [
            '-c.mac.identity=' + releaseSigning.identity.replace(/^Developer ID Application: /, ''),
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
  const name = profile === 'authoring' ? 'Lantern Knight Dev' : 'Lantern Knight';
  const output = inspectable
    ? 'release-inspectable'
    : profile === 'authoring'
      ? 'release-dev'
      : 'release';
  await verifyPackageFuses(
    path.join(
      projectRoot,
      output,
      platform === 'mac' ? `mac-arm64/${name}.app` : `win-unpacked/${name}.exe`,
    ),
    inspectable || profile === 'authoring',
  );
  if (releaseSigning) await notarizeMacApp(releaseSigning, projectRoot);
}
runCli(import.meta.url, () => {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      dev: { type: 'boolean' },
      prebuilt: { type: 'boolean' },
      'prebuilt-web': { type: 'boolean' },
      local: { type: 'boolean' },
      signed: { type: 'boolean' },
      unsigned: { type: 'boolean' },
      inspectable: { type: 'boolean' },
      identity: { type: 'string' },
      'notary-profile': { type: 'string' },
    },
  });
  const platform =
    values.platform ??
    (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : undefined);
  if (platform !== 'mac' && platform !== 'win') throw new Error('Supply --platform mac|win');
  if (values.inspectable && (!values.unsigned || values.signed || values.dev))
    throw new Error(
      '--inspectable requires --unsigned Game packaging; it is not a release artifact',
    );
  const signing = macSigning({ ...values, platform });
  return packageApp(
    platform,
    values.dev ? 'authoring' : 'game',
    values.prebuilt,
    values.local,
    signing,
    values['prebuilt-web'],
    values.inspectable,
  );
});
