import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {AssetCache} from './assets/cache';
import {projectRoot,publicRoot} from './assets/paths';
import {readLock,recipeHash,ensurePack,validatePack,LockSchema,lockFile,type AssetLock} from './assets/pack';
import {prepareAssets} from './assets/prepare';
import {gh,retainedPacks,obsoleteReleases} from './assets/retention';
import {parseManifest} from '../src/assets/schema';
import {assetCatalog} from '../src/content/visuals';
import {readAsset} from './assets/io';

const cache=new AssetCache(),mode=process.argv[2]??'ensure';
async function run(file:string,args:string[]=[],env:NodeJS.ProcessEnv=process.env){
 const child=spawn(process.execPath,[...(file.endsWith('.ts')?['--import','tsx']:[]),file,...args],{cwd:projectRoot,env,stdio:'inherit'});
 const stop=(signal:NodeJS.Signals)=>child.kill(signal),interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
 try{await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`${path.basename(file)} exited ${code??signal}`)));});}finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
async function pinned(){
 if(process.argv.includes('--local')){
  const held=await cache.lease('preparation');
  try{const lock=LockSchema.parse(JSON.parse(await fs.readFile(path.join(held.root,'prepared.json'),'utf8')));if(lock.recipeSha256!==await recipeHash())throw new Error('Local preparation recipe differs; prepare again');const root=path.join(held.root,'work/payload');await validatePack(root,lock);return {lock,held:{...held,root}};}catch(error){await held.release();throw error;}
 }
 const lock=await readLock();if(lock.recipeSha256!==await recipeHash())throw new Error('Asset recipes differ from the pinned pack. Run assets:publish on an art-authoring machine.');return {lock,held:await ensurePack(lock,cache)};}
async function verifyRemote(lock:AssetLock){
 const held=await cache.lease('publication-'+randomUUID());
 try{const response=await fetch(`https://github.com/Talyen/lantern-knight/releases/download/${lock.releaseTag}/${lock.filename}`);if(!response.ok||!response.body)throw new Error(`Published pack unavailable: HTTP ${response.status}`);
  const {createHash}=await import('node:crypto'),digest=createHash('sha256');let count=0;for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){count+=chunk.length;if(count>lock.bytes)throw new Error('Published pack exceeds pinned size');digest.update(chunk);}if(count!==lock.bytes||digest.digest('hex')!==lock.sha256)throw new Error('Published pack hash differs');
 }finally{await held.release();await fs.rm(held.root,{recursive:true,force:true});}
}
export async function publishPrepared(prepared:Awaited<ReturnType<typeof prepareAssets>>,publish=gh,verify=verifyRemote,target=lockFile){
 const lock=prepared.lock;
 if(lock.recipeSha256!==await recipeHash())throw new Error('Asset recipes changed before publication');
 try{const existing=JSON.parse(await publish(['release','view',lock.releaseTag,'--json','assets']));if(!Array.isArray(existing.assets))throw new Error('Invalid existing release metadata');if(!existing.assets.some((a:{name:string})=>a.name===lock.filename))await publish(['release','upload',lock.releaseTag,prepared.archive+'#'+lock.filename]);}
 catch{const commit=(await publish(['api','repos/Talyen/lantern-knight/git/ref/heads/main','--jq','.object.sha'])).trim();await publish(['release','create',lock.releaseTag,prepared.archive+'#'+lock.filename,'--target',commit,'--title','Prepared assets '+lock.sha256.slice(0,16),'--notes','Verified current Game and developer asset pack. Recipe SHA-256: '+lock.recipeSha256,'--latest=false']);}
 await verify(lock);if(lock.recipeSha256!==await recipeHash())throw new Error('Asset recipes changed during publication');
 const temporary=target+'.'+randomUUID();try{await fs.writeFile(temporary,JSON.stringify(lock,null,2)+'\n');await fs.rename(temporary,target);}finally{await fs.rm(temporary,{force:true});}
 console.log('Published and pinned '+lock.releaseTag);
}
async function main(){
 if(mode==='prepare'||mode==='publish'){const prepared=await prepareAssets(cache);try{if(mode==='publish')await publishPrepared(prepared);}finally{await prepared.held.release();}return;}
 if(mode==='clean'){
  const lock=await readLock(),keep=await retainedPacks(lock),obsolete=await obsoleteReleases(keep);
  for(const tag of obsolete)await gh(['release','delete',tag,'--cleanup-tag','--yes']);
  const names=await fs.readdir(path.join(cache.root,'entries'));const removed=await cache.clean(new Set(names.filter(name=>name.startsWith('pack-')&&keep.has('assets-'+name.slice(5,21)))));console.log(`Cleaned ${obsolete.length} obsolete published packs and ${removed} unused cache entries.`);return;
 }
 const {lock,held}=await pinned();const env={...process.env,LANTERN_ASSET_WORKSPACE:held.root,LANTERN_PREPARING:'0'};
 try{
  if(mode==='ensure'){console.log(`Verified ${lock.releaseTag}; ${(lock.bytes/1024**2).toFixed(1)} MiB.`);return;}
  if(mode==='inspect'){const id=process.argv[3];if(!id){console.log(`Prepared pack ${lock.releaseTag}; ${Object.keys(assetCatalog).length} assets. Supply an asset ID for details.`);return;}const file=assetCatalog[id];if(!file)throw new Error('Unknown asset ID');const m=parseManifest(JSON.parse(await readAsset('public/'+file,'utf8')));console.log(JSON.stringify({id,canvas:m.asset.canvas,density:m.asset.density,frames:m.frames.length,pages:m.pages.length,clips:Object.keys(m.asset.clips)},null,2));return;}
  if(mode!=='run')throw new Error('Unknown asset command');const task=process.argv[3],args=process.argv.slice(4).filter(a=>a!=='--local');
  if(task==='build'||task==='build:dev'){
   const dev=task==='build:dev';await run('node_modules/typescript/bin/tsc',['--noEmit'],env);await run('node_modules/vite/bin/vite.js',['build',...(dev?['--mode','sandbox']:[])],env);await run('tools/select-runtime-assets.ts',dev?['--dev']:[],env);await run('tools/build-electron.ts',dev?['--dev']:[],env);await run('tools/build-identity.ts',[...(dev?['--dev']:[]),'--write'],env);
  }else if(task==='test')await run('tools/test.ts',args,env);
  else if(task==='check')await run('tools/check-assets.ts',args,env);
  else if(task==='dev')await run('node_modules/vite/bin/vite.js',args,env);
  else if(task?.endsWith('.ts')&&task.startsWith('tools/'))await run(task,args,env);
  else throw new Error('Unknown asset-backed task');
 }finally{await held.release();}
}
if(process.argv[1]?.endsWith('assets.ts'))main().catch(error=>{console.error(String(error.message??error));process.exitCode=1;});
