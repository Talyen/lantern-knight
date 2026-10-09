import fs from 'node:fs/promises';
import path from 'node:path';
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
