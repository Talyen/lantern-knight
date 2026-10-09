import fs from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import { ArchiveLockSchema } from './pack';
import { safeRelative } from './paths';
import { shaFile } from './sources';
import { listFiles } from './files';
export async function makeArchive(root: string, file: string, recipeSha256: string) {
  const names = (await listFiles(root)).filter((n) => n !== 'pack.json'),
    files: Record<string, { sha256: string; bytes: number }> = {};
  for (const name of names) {
    safeRelative(name);
    if (!/^(public|metadata)\//.test(name)) throw new Error('Unexpected pack payload');
    const p = path.join(root, name);
    files[name] = { sha256: await shaFile(p), bytes: (await fs.stat(p)).size };
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
    },
    [...names, 'pack.json'].sort(),
  );
  const size = (await fs.stat(file)).size;
  if (size >= 2 * 1024 ** 3) throw new Error('Prepared pack must be smaller than 2 GiB');
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
