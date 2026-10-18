import { readJson, writeJsonAtomic } from './json-file';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from './assets/files';

import { shaFile } from './assets/sources';

// A successful hash check is reusable only while every file's identity and metadata match.
export const fileSignature = (stat: import('node:fs').Stats) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode].join(':');
export type VerifiedFiles = Map<string, { signature: string; hash: string }>;
async function fileSignatures(root: string, names: readonly string[]) {
  const signatures: Record<string, string> = {};
  const sorted = [...new Set(names)].sort();
  for (let offset = 0; offset < sorted.length; offset += 64) {
    const batch = sorted.slice(offset, offset + 64);
    const stats = await Promise.all(
      batch.map((name) => fs.lstat(path.join(root, safeRelative(name)))),
    );
    for (const [index, name] of batch.entries()) {
      const stat = stats[index]!;
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('Invalid verified output: ' + name);
      signatures[name] = fileSignature(stat);
    }
  }
  return signatures;
}
async function outputProof(root: string, names: readonly string[], receipt: string) {
  const signature = await fileSignatures(root, names);
  const key = createHash('sha256').update(JSON.stringify(signature)).digest('hex');
  const file = path.join(root, receipt);
  let matches = false;
  try {
    const prior = (await readJson(file)) as { version?: unknown; key?: unknown } | null;
    matches = prior?.version === 1 && prior.key === key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  return { signature, key, file, matches };
}
// A missing member is repairable; an unsafe member must still fail closed.
export async function outputVerified(root: string, names: readonly string[], receipt: string) {
  try {
    return (await outputProof(root, names, receipt)).matches;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}
export async function verifiedOutput(
  root: string,
  names: readonly string[],
  validate: () => Promise<void>,
  receipt = '.verified-output.json',
) {
  const proof = await outputProof(root, names, receipt);
  if (proof.matches) return true;
  await validate();
  if (JSON.stringify(proof.signature) !== JSON.stringify(await fileSignatures(root, names)))
    throw new Error('Output changed during validation');
  await writeJsonAtomic(proof.file, { version: 1, key: proof.key });
  return false;
}

// Delivery identity follows bytes, so an identical rebuild can reuse its proof.
export async function fileChecksums(
  root: string,
  names: readonly string[],
  verified?: VerifiedFiles,
) {
  const before = await fileSignatures(root, names);
  const hashes: Record<string, string> = {};
  const shared = new Map<string, string>();
  for (const proof of verified?.values() ?? []) shared.set(proof.signature, proof.hash);
  for (const [name, signature] of Object.entries(before)) {
    const key = signature.split(':')[1] === '0' ? name : signature;
    const prior = verified?.get(name);
    let hash = prior?.signature === signature ? prior.hash : shared.get(key);
    if (!hash) {
      hash = await shaFile(path.join(root, name));
      shared.set(key, hash);
    }
    hashes[name] = hash;
  }
  if (JSON.stringify(before) !== JSON.stringify(await fileSignatures(root, names)))
    throw new Error('Output changed while hashing');
  for (const [name, hash] of Object.entries(hashes))
    verified?.set(name, { signature: before[name]!, hash });
  return hashes;
}
