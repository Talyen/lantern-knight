import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {z} from 'zod';
import * as tar from 'tar';
import {AssetCache,diskBytes} from './cache';
import {projectRoot,safeRelative,CACHE_LIMIT} from './paths';
import {shaFile} from './sources';

const hash=z.string().regex(/^[a-f0-9]{64}$/),bytes=z.number().int().nonnegative();
export const LockSchema=z.object({schemaVersion:z.literal(1),releaseTag:z.string().regex(/^assets-[a-f0-9]{16}$/),filename:z.literal('lantern-assets.tar.gz'),sha256:hash,inventorySha256:hash,bytes:bytes.positive().max(2*1024**3-1),recipeSha256:hash}).strict();
export type AssetLock=z.infer<typeof LockSchema>;
const PackSchema=z.object({schemaVersion:z.literal(1),recipeSha256:hash,files:z.record(z.string(),z.object({sha256:hash,bytes}).strict())}).strict();
export const lockFile=path.join(projectRoot,'assets/lock.json');
export const readLock=async()=>LockSchema.parse(JSON.parse(await fs.readFile(lockFile,'utf8')));
export async function recipeHash(){
 const names=['assets/sources.json','authoring/surface-depth.json','authoring/hero-actions.json','tools/assets/hero.py','tools/assets/definition.ts','src/content/camera.json','src/assets/schema.ts','src/content/scenery-registration.ts','src/content/graveyard-registration.ts','src/content/graveyard-scene.ts','src/content/crypt-scene.ts','src/content/graveyard-layout.ts','src/content/visuals.ts','src/content/effects-playground-assets.ts','src/presentation/lighting-profiles.ts','tools/compiler.ts','tools/prepare-animation-flow.py','tools/assets/io.ts','tools/assets/sources.ts','tools/assets/source.py','tools/assets/resolver.py','tools/assets/paths.ts','src/assets/registration.ts','tools/assets/prepare.ts','tools/assets/payload.ts',...(await fs.readdir(path.join(projectRoot,'tools'))).filter(n=>n.startsWith('prepare-')&&n.endsWith('.ts')).map(n=>'tools/'+n)];
 const config=JSON.parse(await fs.readFile(path.join(projectRoot,'package.json'),'utf8'));const digest=createHash('sha256').update(JSON.stringify({sharp:config.devDependencies.sharp,three:config.dependencies.three,zod:config.dependencies.zod,tar:config.devDependencies.tar}));for(const name of [...new Set(names)].sort()){digest.update(name+'\0');digest.update(await fs.readFile(path.join(projectRoot,name)));}return digest.digest('hex');
}
export async function listFiles(root:string):Promise<string[]>{
 const result:string[]=[];async function visit(dir:string){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){if(e.name==='.DS_Store')continue;const file=path.posix.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Asset pack contains a symbolic link');if(e.isDirectory())await visit(file);else if(e.isFile())result.push(file);else throw new Error('Unsupported asset file');}}
 await visit('');return result.sort();
}
export async function makeArchive(root:string,file:string,recipeSha256:string){
 const names=(await listFiles(root)).filter(n=>n!=='pack.json'),files:Record<string,{sha256:string;bytes:number}>={};
 for(const name of names){safeRelative(name);if(!/^(public|metadata)\//.test(name))throw new Error('Unexpected pack payload');const p=path.join(root,name);files[name]={sha256:await shaFile(p),bytes:(await fs.stat(p)).size};}
 await fs.writeFile(path.join(root,'pack.json'),JSON.stringify({schemaVersion:1,recipeSha256,files}));
 await tar.c({cwd:root,file,gzip:{level:6},portable:true,mtime:new Date(0),noPax:true},[...names,'pack.json'].sort());
 const size=(await fs.stat(file)).size;if(size>=2*1024**3)throw new Error('Prepared pack must be smaller than 2 GiB');
 const sha256=await shaFile(file);return LockSchema.parse({schemaVersion:1,releaseTag:'assets-'+sha256.slice(0,16),filename:'lantern-assets.tar.gz',sha256,inventorySha256:await shaFile(path.join(root,'pack.json')),bytes:size,recipeSha256});
}
export async function validatePack(root:string,lock:AssetLock){
 const inventory=await fs.readFile(path.join(root,'pack.json'));if(createHash('sha256').update(inventory).digest('hex')!==lock.inventorySha256)throw new Error('Prepared inventory hash differs');const data=PackSchema.parse(JSON.parse(inventory.toString()));
 if(data.recipeSha256!==lock.recipeSha256)throw new Error('Prepared pack recipe differs');
 const actual=(await listFiles(root)).filter(n=>!n.startsWith('.')&&n!=='pack.json'),expected=Object.keys(data.files).sort();
 if(actual.join('\n')!==expected.join('\n'))throw new Error('Prepared pack file inventory differs');
 for(const name of expected){safeRelative(name);if(!/^(public|metadata)\//.test(name))throw new Error('Unexpected pack file');const f=data.files[name]!,file=path.join(root,name);if((await fs.stat(file)).size!==f.bytes||await shaFile(file)!==f.sha256)throw new Error(`Prepared asset differs: ${name}`);}
 return data;
}
export async function inspectArchive(file:string,maxBytes=CACHE_LIMIT){
 const names=new Set<string>(),folded=new Set<string>();let total=0;
 const parser=new tar.Parser({strict:true,maxDecompressionRatio:1000});
 parser.on('entry',entry=>{try{
  const name=entry.path.replace(/\/$/,'');safeRelative(name);
  if(entry.type!=='File'&&entry.type!=='Directory')throw new Error('Archive links and special entries are forbidden');
  if(name!=='pack.json'&&!/^(public|metadata)(\/|$)/.test(name))throw new Error('Unexpected archive root');
  if(names.has(name)||folded.has(name.toLowerCase()))throw new Error('Archive duplicate or case collision');names.add(name);folded.add(name.toLowerCase());
  total+=entry.size;if(!Number.isSafeInteger(total)||total>maxBytes)throw new Error('Archive exceeds cache budget');
 }catch(error){parser.abort(error as Error);}entry.resume();});
 await pipeline(createReadStream(file),parser);if(!names.has('pack.json'))throw new Error('Archive has no inventory');return total;
}
async function installMutex<T>(root:string,work:()=>Promise<T>){
 const file=path.join(root,'.install');
 for(let i=0;;i++){try{await fs.writeFile(file,String(process.pid),{flag:'wx'});break;}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const pid=Number(await fs.readFile(file,'utf8'));try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){await fs.rm(file,{force:true});continue;}}if(i>12000)throw new Error('Asset download is busy');await new Promise(done=>setTimeout(done,50));}}
 try{return await work();}finally{await fs.rm(file,{force:true});}
}
export async function ensurePack(lock:AssetLock,cache=new AssetCache(),request:typeof fetch=fetch,url=`https://github.com/Talyen/lantern-knight/releases/download/${lock.releaseTag}/${lock.filename}`){
 const held=await cache.lease('pack-'+lock.sha256);
 try{await installMutex(held.root,async()=>{
  try{await validatePack(held.root,lock);return;}catch{try{await fs.access(path.join(held.root,'pack.json'));if(!await held.sole())throw new Error('Corrupt prepared pack is in use; stop active commands before repairing it');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  await held.reserve(lock.bytes+await diskBytes(held.root));const archive=path.join(held.root,'.download-'+randomUUID()),incoming=path.join(held.root,'.incoming-'+randomUUID());
  let downloadOutput:ReturnType<typeof createWriteStream>|undefined;
  try{
   const response=await request(url);if(!response.ok||!response.body)throw new Error(`Prepared pack unavailable: HTTP ${response.status}`);
   const output=downloadOutput=createWriteStream(archive,{flags:'wx'}),digest=createHash('sha256');let count=0;
   async function* checked(){for await(const b of response.body as unknown as AsyncIterable<Uint8Array>){count+=b.length;if(count>lock.bytes)throw new Error('Download exceeds pinned size');digest.update(b);yield b;}}
   await pipeline(checked(),output);if(count!==lock.bytes||digest.digest('hex')!==lock.sha256)throw new Error('Prepared pack download hash or size differs');
   const unpacked=await inspectArchive(archive,cache.limit-lock.bytes);await held.reserve(unpacked+await diskBytes(held.root)+4096);
   await fs.mkdir(incoming);await tar.x({cwd:incoming,file:archive,strict:true,preservePaths:false});await validatePack(incoming,lock);
   await fs.mkdir(path.join(incoming,'metadata'),{recursive:true});for(const name of ['public','metadata','pack.json']){await fs.rm(path.join(held.root,name),{recursive:true,force:true});await fs.rename(path.join(incoming,name),path.join(held.root,name));}
  }finally{if(downloadOutput&&!downloadOutput.closed)await new Promise<void>(resolve=>{downloadOutput!.once('close',resolve);downloadOutput!.destroy();});await fs.rm(archive,{force:true});await fs.rm(incoming,{recursive:true,force:true});}
 });return held;}catch(error){await held.release();throw error;}
}
