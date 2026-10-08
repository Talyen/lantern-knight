import { content } from '../content/game-content';
import { parseGame, parseSettings, SAVE_LIMITS, type Bridge, type LoadResult } from '../core/save';
export function createBrowserBridge(profile = 'game'): Bridge {
  const prefix = profile === 'game' ? 'lantern' : `lantern-dev-${profile}`;
  return {
    async loadSettings() {
      return read('settings', parseSettings, prefix);
    },
    async saveSettings(v) {
      const old = read('settings', parseSettings, prefix);
      if (old.status === 'unreadable') throw new Error(old.message);
      write('settings', parseSettings(v), prefix);
    },
    async loadGame() {
      if (profile === 'sandbox') return { status: 'empty' };
      return read('game', (v) => parseGame(v, content), prefix);
    },
    async saveGame(v) {
      if (profile === 'sandbox') throw new Error('Sandbox checkpoint writes denied');
      const old = read('game', (v) => parseGame(v, content), prefix);
      if (old.status === 'unreadable') throw new Error(old.message);
      write('game', parseGame(v, content), prefix);
    },
  };
}
export const browserBridge = createBrowserBridge();
function write(slot: keyof typeof SAVE_LIMITS, value: unknown, prefix = 'lantern') {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > SAVE_LIMITS[slot])
    throw new Error('save payload exceeds limit');
  localStorage.setItem(`${prefix}-${slot}`, text);
}
function read<T>(
  slot: keyof typeof SAVE_LIMITS,
  parse: (v: unknown) => T,
  prefix = 'lantern',
): LoadResult<T> {
  try {
    const value = localStorage.getItem(`${prefix}-${slot}`);
    if (value === null) return { status: 'empty' };
    if (new TextEncoder().encode(value).byteLength > SAVE_LIMITS[slot])
      throw new Error('oversized');
    return { status: 'ok', data: parse(JSON.parse(value)) };
  } catch {
    return {
      status: 'unreadable',
      message: 'Stored data is unreadable; it has been preserved.',
    };
  }
}
