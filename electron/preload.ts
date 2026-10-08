import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, GameSave, Settings } from '../src/core/save';
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
