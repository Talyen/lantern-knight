import path from 'node:path';
export function resourcePath(url:string,root:string){
  const u=new URL(url);if(u.protocol!=='lantern:'||u.host!=='app'||u.search||u.username||u.password)throw new Error('untrusted resource origin');
  const name=decodeURIComponent(u.pathname); // root mapped below
  if(name.includes('\\')||name.includes('\0'))throw new Error('unsafe resource path');
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name)),relative=path.relative(root,file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('resource escapes app root');
  if(!/\.(html|js|css|png|json|ico|glb)$/.test(file))throw new Error('unsupported app resource');return file;
}
export function trustedSender(frameURL:string,isMainFrame:boolean,webContentsId:number,expectedId:number,entry='index.html'){return frameURL===`lantern://app/${entry}`&&isMainFrame&&webContentsId===expectedId;}
