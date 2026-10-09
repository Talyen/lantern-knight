import { sourceFingerprint } from './source-identity';
import { acquireCommandLane } from './command-lane';
export const verificationIdentity = sourceFingerprint;
export async function requireStableInputs(
  root: string,
  before: Awaited<ReturnType<typeof sourceFingerprint>>,
  options: Parameters<typeof sourceFingerprint>[1] = {},
) {
  if (before.sha256 !== (await sourceFingerprint(root, options)).sha256)
    throw new Error('Source inputs changed during the run');
}
export const acquireTestLane = acquireCommandLane;
