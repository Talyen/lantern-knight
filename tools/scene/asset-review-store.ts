import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assetReviewSchema, type AssetReviews } from '../../src/editor/asset-review-data';
import { writeFileAtomic } from '../json-file';

export class AssetReviewConflict extends Error {}
/** Authoring decisions survive preparation, browser restarts and scene changes. */
export class AssetReviewStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async read(): Promise<{ reviews: AssetReviews; revision: string | null }> {
    try {
      const stat = await fs.lstat(this.file);
      if (!stat.isFile() || stat.size > 4 * 1024 ** 2) throw new Error('Invalid asset review file');
      const bytes = await fs.readFile(this.file, 'utf8');
      return {
        reviews: assetReviewSchema.parse(JSON.parse(bytes)),
        revision: createHash('sha256').update(bytes).digest('hex'),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { reviews: { version: 1, entries: [] }, revision: null };
      throw error;
    }
  }
  save(value: unknown, revision: unknown) {
    const reviews = assetReviewSchema.parse(value);
    const work = this.queue.then(async () => {
      if (revision !== null && (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)))
        throw new Error('Invalid asset review revision');
      if ((await this.read()).revision !== revision)
        throw new AssetReviewConflict(
          'The replacement queue changed on disk. Reload queue before saving again. Your notes are preserved.',
        );
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      if ((await fs.lstat(path.dirname(this.file))).isSymbolicLink())
        throw new Error('Asset review directory must not be a symbolic link');
      const bytes = JSON.stringify(reviews, null, 2) + '\n';
      if (Buffer.byteLength(bytes) > 4 * 1024 ** 2) throw new Error('Asset review file too large');
      await writeFileAtomic(this.file, bytes);
      return { reviews, revision: createHash('sha256').update(bytes).digest('hex') };
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
