import type { InputSnapshot } from './task-state';
import fs from 'node:fs/promises';
import { acquireCommandLane } from './command-lane';
import { authoredIdentity } from './authored-inputs';
export const verificationIdentity = (
  root: string,
  options: {
    inputs?: InputSnapshot;
    ignoreAssetPin?: boolean;
    scope?: 'verification' | 'runtime';
    files?: readonly string[];
  } = {},
) =>
  authoredIdentity(root, {
    ...options,
    inputs: options.inputs
      ? {
          files: options.inputs.files,
          commit: options.inputs.commit ?? null,
          dirty: options.inputs.dirty ?? true,
        }
      : undefined,
  });
export async function requireStableInputs(
  root: string,
  before: Awaited<ReturnType<typeof verificationIdentity>>,
  options: {
    ignoreAssetPin?: boolean;
    scope?: 'verification' | 'runtime';
    files?: readonly string[];
  } = {},
) {
  if (before.sha256 !== (await verificationIdentity(root, options)).sha256)
    throw new Error('Source inputs changed during the run; rerun for the current inputs.');
}
export async function guardedBuild(
  root: string,
  stamp: string,
  build: (inputs: Awaited<ReturnType<typeof verificationIdentity>>) => Promise<void>,
  options: { scope?: 'verification' | 'runtime' } = {},
) {
  await fs.rm(stamp, { force: true });
  try {
    const before = await verificationIdentity(root, options);
    await build(before);
    await requireStableInputs(root, before, options);
  } catch (error) {
    await fs.rm(stamp, { force: true });
    throw error;
  }
}

// Direct test/smoke entry points participate too; managed children borrow.
export const acquireTestLane = (
  port = 48158,
  options: Omit<NonNullable<Parameters<typeof acquireCommandLane>[0]>, 'port'> = {},
) => acquireCommandLane({ ...options, port });
