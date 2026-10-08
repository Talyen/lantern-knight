import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { acquireCommandLane } from './command-lane';
import { authoredIdentity } from './authored-inputs';
export const verificationIdentity = (root: string, options: { ignoreAssetPin?: boolean } = {}) =>
  authoredIdentity(root, options);
export async function requireStableInputs(
  root: string,
  before: Awaited<ReturnType<typeof verificationIdentity>>,
  options: { ignoreAssetPin?: boolean } = {},
) {
  if (!isDeepStrictEqual(before, await verificationIdentity(root, options)))
    throw new Error('Source inputs changed during the run; rerun for the current inputs.');
}
export async function guardedBuild(
  root: string,
  stamp: string,
  build: (inputs: Awaited<ReturnType<typeof verificationIdentity>>) => Promise<void>,
) {
  await fs.rm(stamp, { force: true });
  try {
    const before = await verificationIdentity(root);
    await build(before);
    await requireStableInputs(root, before);
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
