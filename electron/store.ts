import fs from 'node:fs/promises';
import path from 'node:path';
import {
  parseGame,
  parseSettings,
  SaveContentError,
  SAVE_FORMAT_VERSION,
  SETTINGS_FORMAT_VERSION,
  SAVE_LIMITS,
  type LoadResult,
} from '../src/core/save';
export type Slot = 'settings' | 'game';
const version = (slot: Slot) => (slot === 'game' ? SAVE_FORMAT_VERSION : SETTINGS_FORMAT_VERSION);
export function parseSlot(slot: Slot, value: unknown) {
  return slot === 'game' ? parseGame(value) : parseSettings(value);
}
export function validateRequest(slot: Slot, value: unknown) {
  if (!['game', 'settings'].includes(slot)) throw new Error('unknown app-owned slot');
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text) > SAVE_LIMITS[slot])
    throw new Error('save payload exceeds limit');
  return parseSlot(slot, value);
}
class UnsupportedSave extends Error {}
function decode(slot: Slot, text: string) {
  const raw = JSON.parse(text);
  if (typeof raw?.version === 'number' && raw.version > version(slot))
    throw new UnsupportedSave('Newer save version preserved; writing refused.');
  return parseSlot(slot, raw);
}
async function boundedRead(file: string, limit: number) {
  const handle = await fs.open(file, 'r');
  try {
    if ((await handle.stat()).size > limit) throw new Error('oversized save');
    const buffer = Buffer.alloc(limit + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > limit) throw new Error('oversized save');
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}
export class Store {
  queue: Promise<void> = Promise.resolve();
  constructor(public directory: string) {}
  async load(slot: Slot): Promise<LoadResult<ReturnType<typeof parseSlot>>> {
    await this.queue;
    let exists = false;
    for (const suffix of ['.json', '.bak'])
      try {
        const text = await boundedRead(path.join(this.directory, slot + suffix), SAVE_LIMITS[slot]);
        exists = true;
        return {
          status: suffix === '.json' ? 'ok' : 'recovered',
          data: decode(slot, text),
        };
      } catch (e) {
        if (e instanceof UnsupportedSave || e instanceof SaveContentError)
          return { status: 'unreadable', message: e.message };
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') exists = true;
      }
    return exists
      ? {
          status: 'unreadable',
          message:
            'No readable primary/backup save. Files preserved; automatic overwrite disabled.',
        }
      : { status: 'empty' };
  }
  save(slot: Slot, value: unknown) {
    const validated = validateRequest(slot, value);
    const write = async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, slot + '.json');
      let old: string | undefined;
      try {
        old = await boundedRead(file, SAVE_LIMITS[slot]);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (old === undefined) {
        // A missing primary does not authorize replacing an unreadable slot.
        // The backup may be the only remaining copy of a newer/content save.
        try {
          const backup = await boundedRead(
            path.join(this.directory, slot + '.bak'),
            SAVE_LIMITS[slot],
          );
          try {
            decode(slot, backup);
          } catch (e) {
            if (e instanceof UnsupportedSave || e instanceof SaveContentError) throw e;
            throw new Error('Unreadable backup preserved; writing refused.');
          }
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }
      if (old !== undefined) {
        let valid = false;
        try {
          decode(slot, old);
          valid = true;
        } catch (e) {
          if (e instanceof UnsupportedSave || e instanceof SaveContentError) throw e;
        }
        if (valid) {
          await fs.writeFile(file + '.bak.tmp', old);
          await fs.rename(file + '.bak.tmp', path.join(this.directory, slot + '.bak'));
        } else {
          try {
            decode(
              slot,
              await boundedRead(path.join(this.directory, slot + '.bak'), SAVE_LIMITS[slot]),
            );
          } catch {
            throw new Error('Unreadable save preserved; restore a valid backup before writing.');
          }
          await fs.copyFile(file, path.join(this.directory, slot + '.corrupt'));
        }
      }
      const temp = file + '.tmp',
        handle = await fs.open(temp, 'w', 0o600);
      try {
        await handle.writeFile(JSON.stringify(validated));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, file);
    };
    const result = this.queue.then(write);
    this.queue = result.catch(() => {});
    return result;
  }
}
