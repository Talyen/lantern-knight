import { content } from '../content/game-content';
import { parseGame, parseSettings, SAVE_LIMITS, type Bridge, type LoadResult } from '../core/save';
export function createBrowserBridge(profile = 'game'): Bridge {
  const prefix = 'lantern-prototype-' + profile;
  return {
    async loadSettings() {
      return read('settings', parseSettings, prefix);
    },
    async saveSettings(value) {
      write('settings', parseSettings(value), prefix);
    },
    async loadGame() {
      return profile === 'sandbox'
        ? { status: 'empty' }
        : read('game', (value) => parseGame(value, content), prefix);
    },
    async saveGame(value) {
      if (profile === 'sandbox') throw new Error('Sandbox checkpoint writes denied');
      write('game', parseGame(value, content), prefix);
    },
  };
}
export const browserBridge = createBrowserBridge();
function write(slot: keyof typeof SAVE_LIMITS, value: unknown, prefix: string) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > SAVE_LIMITS[slot])
    throw new Error('Save payload exceeds limit');
  localStorage.setItem(prefix + '-' + slot, text);
}
function read<T>(
  slot: keyof typeof SAVE_LIMITS,
  parse: (value: unknown) => T,
  prefix: string,
): LoadResult<T> {
  const value = localStorage.getItem(prefix + '-' + slot);
  if (value === null || new TextEncoder().encode(value).byteLength > SAVE_LIMITS[slot])
    return { status: 'empty' };
  try {
    return { status: 'ok', data: parse(JSON.parse(value)) };
  } catch {
    return { status: 'empty' };
  }
}
