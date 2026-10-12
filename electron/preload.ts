import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge } from '../src/platform/bridge';
import type { GameSave } from '../src/core/save';
import type { Settings } from '../src/platform/settings';
declare const __DEV_APP__: boolean;
const bridge: Bridge = {
  automatedRun: process.argv.includes('--lantern-automated-run'),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (value: Settings) => ipcRenderer.invoke('save-settings', value),
  loadGame: () => ipcRenderer.invoke('load-game'),
  saveGame: (value: GameSave) => ipcRenderer.invoke('save-game', value),
};
if (__DEV_APP__) bridge.launchMode = (mode) => ipcRenderer.invoke('launch-mode', mode);
contextBridge.exposeInMainWorld('lantern', bridge);
