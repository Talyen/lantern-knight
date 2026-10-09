import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { content } from '../src/content/game-content';
import { parseGame, parseSettings, SAVE_LIMITS, type LoadResult } from '../src/core/save';
export type Slot = 'game' | 'settings';
export function parseSlot(slot: Slot, value: unknown) {
  return slot === 'game' ? parseGame(value, content) : parseSettings(value);
}
export function validateRequest(slot: Slot, value: unknown) {
  if (!['game', 'settings'].includes(slot)) throw new Error('Unknown app-owned slot');
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > SAVE_LIMITS[slot])
    throw new Error('Save payload exceeds limit');
  return parseSlot(slot, value);
}
export class Store {
  queue: Promise<void> = Promise.resolve();
  constructor(public directory: string) {}
  async load(slot: Slot): Promise<LoadResult<ReturnType<typeof parseSlot>>> {
    await this.queue;
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
      try {
        return { status: 'ok', data: parseSlot(slot, JSON.parse(bytes.toString())) };
      } catch {
        return { status: 'empty' };
      }
    } finally {
      await handle.close();
    }
  }
  save(slot: Slot, value: unknown) {
    const snapshot = validateRequest(slot, value);
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
    const result = this.queue.then(write);
    this.queue = result.catch(() => {});
    return result;
  }
}
