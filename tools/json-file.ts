import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

// Parsing and schema admission stay separate: callers validate their own contracts.
export async function readJson(file: string) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

export function writeJson(file: string, value: unknown) {
  return fs.writeFile(file, JSON.stringify(value));
}

// Use a unique sibling so failed or concurrent writes cannot damage an accepted file.
export async function writeFileAtomic(file: string, bytes: string | Buffer) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.close();
    await fs.rename(temporary, file);
  } finally {
    await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

export function writeJsonAtomic(file: string, value: unknown, pretty = false) {
  return writeFileAtomic(
    file,
    JSON.stringify(value, null, pretty ? 2 : undefined) + (pretty ? '\n' : ''),
  );
}
