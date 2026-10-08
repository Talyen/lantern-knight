import fs from 'node:fs/promises';
import path from 'node:path';
import { assetFile, assetRoot } from './paths';
import { readLibrarySource } from './sources';
import { diskBytes } from './cache';

export function readAsset(file: string): Promise<Buffer>;
export function readAsset(file: string, encoding: BufferEncoding): Promise<string>;
export async function readAsset(file: string, encoding?: BufferEncoding) {
  let data: Buffer;
  if (file.startsWith('references/art/')) {
    const [group, ...rest] = file.slice(15).split('/');
    data = await readLibrarySource(rest.join('/'), group!);
  } else data = await fs.readFile(assetFile(file));
  return encoding ? data.toString(encoding) : data;
}
export async function writeAsset(file: string, data: Buffer | string) {
  const target = assetFile(file),
    root = assetRoot();
  if (
    process.env.LANTERN_PREPARING !== '1' ||
    !process.env.LANTERN_ASSET_WORKSPACE ||
    !target.startsWith(root + path.sep)
  )
    throw new Error('Preparation may only write its cache workspace');
  const budget = Number(process.env.LANTERN_PREPARE_BUDGET ?? 3 * 1024 ** 3),
    size = Buffer.byteLength(data);
  let prior = 0;
  try {
    prior = (await fs.stat(target)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if ((await diskBytes(root)) - prior + size > budget)
    throw new Error('Asset preparation exceeds reserved cache space');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}
export const mkdirAsset = (file: string, options: { recursive?: boolean }) =>
  fs.mkdir(assetFile(file), options);

// A preparation phase that owns every write can account incrementally instead
// of walking thousands of immutable files again for each output. Other scripts
// retain writeAsset's full scan when they also write through the compiler.
export async function assetWriter() {
  const root = assetRoot(),
    budget = Number(process.env.LANTERN_PREPARE_BUDGET ?? 3 * 1024 ** 3);
  if (process.env.LANTERN_PREPARING !== '1' || !process.env.LANTERN_ASSET_WORKSPACE)
    throw new Error('Budgeted writing requires exclusive asset preparation');
  let bytes = await diskBytes(root),
    pending = Promise.resolve();
  return (file: string, data: Buffer | string) => {
    pending = pending.then(async () => {
      const target = assetFile(file);
      if (!target.startsWith(root + path.sep))
        throw new Error('Preparation output escapes workspace');
      const prior = await fs.stat(target).then(
        (s) => s.size,
        (e) => {
          if (e.code === 'ENOENT') return 0;
          throw e;
        },
      );
      const next = bytes - prior + Buffer.byteLength(data);
      if (next > budget) throw new Error('Asset preparation exceeds reserved cache space');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
      bytes = next;
    });
    return pending;
  };
}
