import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { ArchiveLockSchema } from './pack';

import { shaFile } from './sources';
import { createHash } from 'node:crypto';
import { fileChecksums } from '../verified-files';
import { safeRelative, listFiles } from './files';
export async function makeArchive(
  root: string,
  file: string,
  recipeSha256: string,
  verified?: import('./pack').PackInventory['files'],
) {
  const names = (await listFiles(root)).filter((n) => n !== 'pack.json'),
    files: Record<string, { sha256: string; bytes: number }> = {},
    stats = new Map<string, Stats>();
  for (const name of names) {
    safeRelative(name);
    if (!/^(public|metadata)\//.test(name)) throw new Error('Unexpected pack payload');
    const p = path.join(root, name);
    const stat = await fs.stat(p);
    // Cache hardlinks share storage; delivered archives contain regular files.
    // The downloader deliberately rejects archive links.
    stat.nlink = 1;
    stats.set(path.resolve(p), stat);
    const proof = verified?.[name];
    if (verified && (!proof || proof.bytes !== stat.size))
      throw new Error('Verified archive input differs: ' + name);
    files[name] = { sha256: proof?.sha256 ?? (await shaFile(p)), bytes: stat.size };
  }
  await fs.writeFile(
    path.join(root, 'pack.json'),
    JSON.stringify({ schemaVersion: 1, recipeSha256, files }),
  );
  await tar.c(
    {
      cwd: root,
      file,
      gzip: { level: 6 },
      portable: true,
      mtime: new Date(0),
      noPax: true,
      statCache: stats,
    },
    [...names, 'pack.json'].sort(),
  );
  const size = (await fs.stat(file)).size;
  const sha256 = await shaFile(file);
  return ArchiveLockSchema.parse({
    schemaVersion: 1,
    releaseTag: 'assets-' + sha256.slice(0, 16),
    filename: 'lantern-assets.tar.gz',
    sha256,
    inventorySha256: await shaFile(path.join(root, 'pack.json')),
    bytes: size,
    recipeSha256,
  });
}

// Split delivery needs a verified inventory, not a throwaway monolithic gzip.
// The outer v3 identity names this inventory; only its bundles are downloaded.
export async function inventoryCandidate(
  root: string,
  recipeSha256: string,
  checksums = (names: readonly string[]) => fileChecksums(root, names),
) {
  const names = (await listFiles(root)).filter(
    (name) => name !== 'pack.json' && !name.startsWith('.'),
  );
  const hashes = await checksums(names);
  const files: Record<string, { sha256: string; bytes: number }> = {};
  for (const name of names) {
    safeRelative(name);
    if (!/^(public|metadata)\//.test(name)) throw new Error('Unexpected pack payload');
    files[name] = { sha256: hashes[name]!, bytes: (await fs.stat(path.join(root, name))).size };
  }
  const bytes = JSON.stringify({ schemaVersion: 1, recipeSha256, files });
  await fs.writeFile(path.join(root, 'pack.json'), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return ArchiveLockSchema.parse({
    schemaVersion: 1,
    releaseTag: 'assets-' + sha256.slice(0, 16),
    filename: 'lantern-assets.tar.gz',
    sha256,
    inventorySha256: sha256,
    bytes: Object.values(files).reduce((sum, file) => sum + file.bytes, Buffer.byteLength(bytes)),
    recipeSha256,
  });
}
