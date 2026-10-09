import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseSceneFragment, sceneBytesLimit } from '../../src/content/scene-document';
export class FragmentStore {
  constructor(private directory: string) {}
  private async location(id: string) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid fragment identity');
    await fs.mkdir(this.directory, { recursive: true });
    if ((await fs.lstat(this.directory)).isSymbolicLink())
      throw new Error('Fragment directory must not be a symbolic link');
    return path.join(this.directory, id + '.json');
  }
  async list() {
    await this.location('untitled');
    const files = (await fs.readdir(this.directory)).filter((p) => p.endsWith('.json')).sort();
    return Promise.all(
      files.map(async (file) => ({
        id: file.slice(0, -5),
        fragment: await this.read(file.slice(0, -5)),
      })),
    );
  }
  async read(id: string) {
    const file = await this.location(id);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > sceneBytesLimit) throw new Error('Invalid fragment file');
    return parseSceneFragment(JSON.parse(await fs.readFile(file, 'utf8')));
  }
  async create(value: unknown) {
    const fragment = parseSceneFragment(value),
      id = 'fragment-' + randomUUID(),
      file = await this.location(id);
    const bytes = JSON.stringify(fragment, null, 2) + '\n';
    if (Buffer.byteLength(bytes) > sceneBytesLimit) throw new Error('Fragment exceeds size limit');
    const temp = file + '.tmp';
    try {
      await fs.writeFile(temp, bytes, { flag: 'wx' });
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
    return { id, fragment };
  }
}
