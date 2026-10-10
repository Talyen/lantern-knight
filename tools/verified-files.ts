import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeRelative } from './assets/files';

import { shaFile } from './assets/sources';

// A successful hash check is reusable only while every file's identity and metadata match.
async function fileSignatures(root: string, names: readonly string[]) {
  const signatures: Record<string, string> = {};
  for (const name of [...new Set(names)].sort()) {
    safeRelative(name);
    const stat = await fs.lstat(path.join(root, name));
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Invalid verified output: ' + name);
    signatures[name] = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode].join(
      ':',
    );
  }
  return signatures;
}
export async function verifiedOutput(
  root: string,
  names: readonly string[],
  validate: () => Promise<void>,
  receipt = '.verified-output.json',
) {
  const signature = await fileSignatures(root, names);
  const key = createHash('sha256').update(JSON.stringify(signature)).digest('hex');
  const file = path.join(root, receipt);
  try {
    const prior = JSON.parse(await fs.readFile(file, 'utf8')) as { version: number; key: string };
    if (prior.version === 1 && prior.key === key) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
  await validate();
  if (JSON.stringify(signature) !== JSON.stringify(await fileSignatures(root, names)))
    throw new Error('Output changed during validation');
  await fs.writeFile(file, JSON.stringify({ version: 1, key }));
  return false;
}

// Delivery identity follows bytes, so an identical rebuild can reuse its proof.
export async function fileChecksums(root: string, names: readonly string[]) {
  const before = await fileSignatures(root, names);
  const hashes: Record<string, string> = {};
  for (const name of Object.keys(before)) hashes[name] = await shaFile(path.join(root, name));
  if (JSON.stringify(before) !== JSON.stringify(await fileSignatures(root, names)))
    throw new Error('Output changed while hashing');
  return hashes;
}
