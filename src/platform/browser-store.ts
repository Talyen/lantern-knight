import {
  parseGame,
  parseSettings,
  SAVE_LIMITS,
  type Bridge,
  type LoadResult,
} from '../core/save';
export const browserBridge: Bridge = {
  async loadSettings() {
    return read('settings', parseSettings);
  },
  async saveSettings(v) {
    const old = read('settings', parseSettings);
    if (old.status === 'unreadable') throw new Error(old.message);
    write('settings', parseSettings(v));
  },
  async loadGame() {
    return read('game', parseGame);
  },
  async saveGame(v) {
    const old = read('game', parseGame);
    if (old.status === 'unreadable') throw new Error(old.message);
    write('game', parseGame(v));
  },
};
function write(slot: keyof typeof SAVE_LIMITS, value: unknown) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > SAVE_LIMITS[slot])
    throw new Error('save payload exceeds limit');
  localStorage.setItem(`lantern-${slot}`, text);
}
function read<T>(
  slot: keyof typeof SAVE_LIMITS,
  parse: (v: unknown) => T,
): LoadResult<T> {
  try {
    const value = localStorage.getItem(`lantern-${slot}`);
    if (value === null) return {status: 'empty'};
    if (new TextEncoder().encode(value).byteLength > SAVE_LIMITS[slot])
      throw new Error('oversized');
    return {status: 'ok', data: parse(JSON.parse(value))};
  } catch {
    return {
      status: 'unreadable',
      message: 'Stored data is unreadable; it has been preserved.',
    };
  }
}
