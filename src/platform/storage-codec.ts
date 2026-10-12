import { parseGame, type GameSave } from '../core/save';
import type { ContentRegistry } from '../content/world';
import { parseSettings, type Settings } from './settings';
import type { LoadResult } from './bridge';

export type StoredValues = { game: GameSave; settings: Settings };
export type Slot = keyof StoredValues;
export const SAVE_LIMITS = { game: 1024 * 1024, settings: 16 * 1024 } as const;

// Transport-independent validation. The host selects content, never the payload.
export class StorageCodec {
  private readonly parsers: { [S in Slot]: (value: unknown) => StoredValues[S] };
  constructor(registry: ContentRegistry) {
    this.parsers = {
      game: (value) => parseGame(value, registry),
      settings: parseSettings,
    };
  }
  private parse<S extends Slot>(slot: S, value: unknown): StoredValues[S] {
    if (!Object.hasOwn(SAVE_LIMITS, slot)) throw new Error('Unknown app-owned slot');
    return this.parsers[slot](value);
  }
  decode<S extends Slot>(slot: S, text: string | null): LoadResult<StoredValues[S]> {
    if (text === null || new TextEncoder().encode(text).byteLength > SAVE_LIMITS[slot])
      return { status: 'empty' };
    try {
      return { status: 'ok', data: this.parse(slot, JSON.parse(text)) };
    } catch {
      return { status: 'empty' };
    }
  }
  snapshot<S extends Slot>(slot: S, value: unknown): StoredValues[S] {
    if (!Object.hasOwn(SAVE_LIMITS, slot)) throw new Error('Unknown app-owned slot');
    const text = JSON.stringify(value);
    if (!text || new TextEncoder().encode(text).byteLength > SAVE_LIMITS[slot])
      throw new Error('Save payload exceeds limit');
    return this.parse(slot, value);
  }
}
