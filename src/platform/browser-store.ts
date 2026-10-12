import type { ContentRegistry } from '../content/world';
import type { Bridge } from './bridge';
import { StorageCodec, type Slot } from './storage-codec';

export function createBrowserBridge(registry: ContentRegistry, profile = 'game'): Bridge {
  const prefix = 'lantern-prototype-' + profile,
    codec = new StorageCodec(registry),
    read = <S extends Slot>(slot: S) =>
      codec.decode(slot, localStorage.getItem(prefix + '-' + slot)),
    write = (slot: Slot, value: unknown) => {
      const snapshot = codec.snapshot(slot, value);
      localStorage.setItem(prefix + '-' + slot, JSON.stringify(snapshot));
    };
  return {
    async loadSettings() {
      return read('settings');
    },
    async saveSettings(value) {
      write('settings', value);
    },
    async loadGame() {
      return profile === 'sandbox' ? { status: 'empty' } : read('game');
    },
    async saveGame(value) {
      if (profile === 'sandbox') throw new Error('Sandbox checkpoint writes denied');
      write('game', value);
    },
  };
}
