import {contextBridge,ipcRenderer} from 'electron';
import type {Bridge,GameSave,Settings} from '../src/core/save';
const bridge:Bridge={loadSettings:()=>ipcRenderer.invoke('load-settings'),saveSettings:(value:Settings)=>ipcRenderer.invoke('save-settings',value),loadGame:()=>ipcRenderer.invoke('load-game'),saveGame:(value:GameSave)=>ipcRenderer.invoke('save-game',value)};
contextBridge.exposeInMainWorld('lantern',bridge);
