import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ContentRegistry } from '../src/content/world';
import type { LoadResult } from '../src/platform/bridge';
import {
  StorageCodec,
  SAVE_LIMITS,
  type Slot,
  type StoredValues,
} from '../src/platform/storage-codec';
export class Store {
  private queue: Promise<void> = Promise.resolve();
  private readonly codec: StorageCodec;
  constructor(
    public directory: string,
    registry: ContentRegistry,
  ) {
    this.codec = new StorageCodec(registry);
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  drain() {
    return this.queue;
  }
  load<S extends Slot>(slot: S): Promise<LoadResult<StoredValues[S]>> {
    return this.enqueue(() => this.read(slot));
  }
  private async read<S extends Slot>(slot: S): Promise<LoadResult<StoredValues[S]>> {
    let handle;
    try {
      handle = await fs.open(path.join(this.directory, slot + '.json'), 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'empty' };
      throw error;
    }
    try {
      if ((await handle.stat()).size > SAVE_LIMITS[slot]) return { status: 'empty' };
      const bytes = await handle.readFile();
      if (bytes.length > SAVE_LIMITS[slot]) return { status: 'empty' };
      return this.codec.decode(slot, bytes.toString());
    } finally {
      await handle.close();
    }
  }
  save(slot: Slot, value: unknown) {
    const snapshot = this.codec.snapshot(slot, value);
    const write = async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, slot + '.json'),
        temporary = file + '.' + randomUUID() + '.tmp';
      try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify(snapshot));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    };
    return this.enqueue(write);
  }
}
