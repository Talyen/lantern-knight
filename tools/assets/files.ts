import fs from 'node:fs/promises';
import path from 'node:path';
import { safeRelative } from './paths';

export async function exactSource(relative: string, base: string) {
  safeRelative(relative);
  let current = base;
  for (const part of relative.split('/')) {
    if (!(await fs.readdir(current)).includes(part))
      throw new Error(`exact filename case or missing file: ${relative}`);
    current = path.join(current, part);
  }
  const real = await fs.realpath(current),
    baseReal = await fs.realpath(base);
  if (!real.startsWith(baseReal + path.sep))
    throw new Error(`source escapes approved root: ${relative}`);
  return fs.readFile(current);
}

export async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(dir: string) {
    for (const e of await fs.readdir(path.join(root, dir), {
      withFileTypes: true,
    })) {
      if (e.name === '.DS_Store') continue;
      const file = path.posix.join(dir, e.name);
      if (e.isSymbolicLink()) throw new Error('Asset pack contains a symbolic link');
      if (e.isDirectory()) await visit(file);
      else if (e.isFile()) result.push(file);
      else throw new Error('Unsupported asset file');
    }
  }
  await visit('');
  return result.sort();
}
