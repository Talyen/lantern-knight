import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';
import assert from 'node:assert/strict';

export async function verifyPackageFuses(executable: string, inspectable = false) {
  const fuses = await getCurrentFuseWire(executable);
  for (const [fuse, enabled] of [
    [FuseV1Options.RunAsNode, inspectable],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
    [FuseV1Options.EnableNodeCliInspectArguments, inspectable],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
    [FuseV1Options.OnlyLoadAppFromAsar, true],
  ] as const)
    assert.equal(
      fuses[fuse],
      enabled ? FuseState.ENABLE : FuseState.DISABLE,
      'Packaged fuse: ' + FuseV1Options[fuse],
    );
  console.log(
    'PASS: packaged Electron fuses (' +
      (inspectable ? 'inspectable diagnostic package' : 'hardened release') +
      ').',
  );
}
