import fs from 'node:fs/promises';
import { assetFile } from './paths';
import { readLibrarySource } from './sources';
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
