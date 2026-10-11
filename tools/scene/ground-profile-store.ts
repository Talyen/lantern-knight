import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { GroundProfileSchema, type GroundProfile } from '../../src/content/ground-profile';
import { sceneBytesLimit } from '../../src/content/scene-document';

/** Content-addressed authored revisions, independent of scenes and asset output. */
export class GroundProfileStore {
  constructor(readonly directory: string) {}
  private async location(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid ground profile revision');
    await fs.mkdir(this.directory, { recursive: true });
    if (!(await fs.lstat(this.directory)).isDirectory())
      throw new Error('Ground profile directory must be a regular directory');
    const file = path.join(this.directory, id + '.json');
    try {
      if (!(await fs.lstat(file)).isFile())
        throw new Error('Ground profile must be a regular file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return file;
  }
  async save(value: GroundProfile) {
    const profile = GroundProfileSchema.parse(value);
    const bytes = JSON.stringify(profile) + '\n';
    if (Buffer.byteLength(bytes) > sceneBytesLimit) throw new Error('Ground profile exceeds 4 MiB');
    const id = createHash('sha256').update(bytes).digest('hex');
    const file = await this.location(id),
      temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' });
      // A hard link publishes a complete file without overwriting an earlier revision.
      try {
        await fs.link(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      if ((await fs.readFile(file, 'utf8')) !== bytes)
        throw new Error('Ground profile revision is damaged; original preserved');
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return id;
  }
  async read(id: string) {
    const file = await this.location(id);
    if ((await fs.stat(file)).size > sceneBytesLimit)
      throw new Error('Ground profile exceeds 4 MiB');
    const bytes = await fs.readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== id)
      throw new Error('Ground profile revision is damaged');
    return GroundProfileSchema.parse(JSON.parse(bytes.toString()));
  }
  async list() {
    await this.location('0'.repeat(64));
    const result = [];
    for (const file of (await fs.readdir(this.directory)).filter((f) =>
      /^[a-f0-9]{64}\.json$/.test(f),
    )) {
      const id = file.slice(0, -5),
        profile = await this.read(id);
      result.push({
        id,
        name: profile.name,
        asset: profile.interaction.asset,
        hash: profile.interaction.hash,
        regions: profile.interaction.regions.length,
        time: (await fs.stat(path.join(this.directory, file))).mtimeMs,
      });
    }
    return result.sort((a, b) => b.time - a.time);
  }
}
