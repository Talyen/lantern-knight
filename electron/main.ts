import {app,BrowserWindow,ipcMain,net,protocol,session,powerMonitor,Menu} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from './store';
import {resourcePath,trustedSender} from './security';
protocol.registerSchemesAsPrivileged([{scheme:'lantern',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(process.env.LANTERN_USER_DATA)app.setPath('userData',path.resolve(process.env.LANTERN_USER_DATA)); // app-owned test harness only; never renderer-selected
app.enableSandbox();
let window:BrowserWindow|undefined;
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);const root=path.join(app.getAppPath(),'dist');
  protocol.handle('lantern',async request=>{try{if(request.method!=='GET')return new Response('method denied',{status:405});return await net.fetch(pathToFileURL(resourcePath(request.url,root)).toString());}catch{return new Response('resource denied',{status:403});}});
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  const store=new Store(path.join(app.getPath('userData'),'saves'));
  window=new BrowserWindow({width:1440,height:900,backgroundColor:'#151923',title:'Lantern Knight • Foundation',webPreferences:{preload:path.join(app.getAppPath(),'dist-electron/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.webContents.on('will-attach-webview',event=>event.preventDefault());
  for(const [channel,slot,write] of [['load-settings','settings',false],['save-settings','settings',true],['load-game','game',false],['save-game','game',true]] as const)ipcMain.handle(channel,(event,value)=>{
    if(!window||!event.senderFrame||!trustedSender(event.senderFrame.url,event.senderFrame===event.sender.mainFrame,event.sender.id,window.webContents.id))throw new Error('untrusted IPC sender');
    if(!write&&value!==undefined)throw new Error('load takes no payload');return write?store.save(slot,value):store.load(slot);
  });
  powerMonitor.on('suspend',()=>window?.webContents.executeJavaScript('window.dispatchEvent(new Event("blur"))').catch(()=>{}));
  await window.loadURL('lantern://app/index.html');
});
app.on('window-all-closed',()=>app.quit());
