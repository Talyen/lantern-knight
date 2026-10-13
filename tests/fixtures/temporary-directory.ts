import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

export async function temporaryDirectory(t: TestContext, prefix: string) {
  const directory = await fs.mkdtempDisposable(path.join(os.tmpdir(), prefix));
  t.after(() => directory.remove());
  return directory.path;
}
