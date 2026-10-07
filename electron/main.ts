import {app,BrowserWindow,ipcMain,net,protocol,session,powerMonitor,Menu} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchEntry,checkpointDirectory} from './launch';
import {Store} from './store';
import {resourcePath,trustedSender} from './security';
declare const __DEV_APP__:boolean;
protocol.registerSchemesAsPrivileged([{scheme:'lantern',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(__DEV_APP__)app.setPath('userData',path.join(app.getPath('appData'),'Lantern Knight Dev'));
if(process.env.LANTERN_USER_DATA)app.setPath('userData',path.resolve(process.env.LANTERN_USER_DATA)); // app-owned test harness only; never renderer-selected
app.enableSandbox();
const hiddenTest=process.env.LANTERN_TEST_HIDDEN==='1';
let window:BrowserWindow|undefined;
app.whenReady().then(async()=>{
  if(hiddenTest&&process.platform==='darwin')app.setActivationPolicy('accessory');
  Menu.setApplicationMenu(null);const applicationRoot=app.isPackaged?app.getAppPath():process.cwd();const root=path.join(applicationRoot,__DEV_APP__?'dist-dev':'dist');
  protocol.handle('lantern',async request=>{try{if(request.method!=='GET')return new Response('method denied',{status:405});return await net.fetch(pathToFileURL(resourcePath(request.url,root)).toString());}catch{return new Response('resource denied',{status:403});}});
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  let mode:'game'|'sandbox'|'effects'=__DEV_APP__&&process.argv.includes('--effects')?'effects':__DEV_APP__&&!process.argv.includes('--game')?'sandbox':'game';
  const profileRoot=app.getPath('userData');
  const storeFor=(selected:'game'|'sandbox'|'effects')=>new Store(checkpointDirectory(profileRoot,__DEV_APP__,selected));
  let store=storeFor(mode);
  const entry=()=>launchEntry(__DEV_APP__,mode);
  window=new BrowserWindow({width:1280,height:800,show:!hiddenTest,focusable:!hiddenTest,enableLargerThanScreen:true,backgroundColor:'#151923',title:__DEV_APP__?'Lantern Knight Dev':'Lantern Knight',webPreferences:{preload:path.join(applicationRoot,__DEV_APP__?'dist-electron-dev/preload.cjs':'dist-electron/preload.cjs'),backgroundThrottling:!hiddenTest,contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
  window.on('blur',()=>window?.webContents.executeJavaScript('window.dispatchEvent(new Event("blur"))').catch(()=>{}));
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  for(const [channel,slot,write] of [['load-settings','settings',false],['save-settings','settings',true],['load-game','game',false],['save-game','game',true]] as const)ipcMain.handle(channel,(event,value)=>{
    if(!window||!event.senderFrame||!trustedSender(event.senderFrame.url,event.senderFrame===event.sender.mainFrame,event.sender.id,window.webContents.id,entry()))throw new Error('untrusted IPC sender');
    if(mode!=='game'&&slot==='game'){if(write)throw new Error('Sandbox checkpoint writes denied');return {status:'empty'};}
    if(!write&&value!==undefined)throw new Error('load takes no payload');return write?store.save(slot,value):store.load(slot);
  });
  powerMonitor.on('suspend',()=>window?.webContents.executeJavaScript('window.dispatchEvent(new Event("blur"))').catch(()=>{}));
  if(__DEV_APP__)ipcMain.handle('launch-mode',async(event,next)=>{
    if(!window||!event.senderFrame||!trustedSender(event.senderFrame.url,event.senderFrame===event.sender.mainFrame,event.sender.id,window.webContents.id,entry())||!['game','sandbox','effects'].includes(next))throw new Error('invalid development launch');
    await store.queue;mode=next;store=storeFor(mode);await window.loadURL(`lantern://app/${entry()}`);
  });
  await window.loadURL(`lantern://app/${entry()}`);
});
app.on('window-all-closed',()=>app.quit());
