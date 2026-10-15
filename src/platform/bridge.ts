import type { GameSave } from '../core/save';
import type { Settings } from './settings';
export type LoadResult<T> =
  { status: 'empty'; reason?: 'incompatible' } | { status: 'ok'; data: T };
export interface Bridge {
  readonly automatedRun?: boolean;
  launchMode?(mode: 'game' | 'sandbox' | 'effects' | 'editor'): Promise<void>;
  loadSettings(): Promise<LoadResult<Settings>>;
  saveSettings(value: Settings): Promise<void>;
  loadGame(): Promise<LoadResult<GameSave>>;
  saveGame(value: GameSave): Promise<void>;
}
declare global {
  interface Window {
    lantern?: Bridge;
  }
}
