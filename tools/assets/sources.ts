import path from 'node:path';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {projectRoot,sourceLibrary,safeRelative} from './paths';
const indexPath=path.join(projectRoot,'assets/sources.json');
export async function shaFile(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

// One reader per tooling process shares discovery and verified archive hashes.
// Close it after idle work so it never keeps a finished build/test process alive.
let worker:ChildProcessWithoutNullStreams|undefined,id=0,idle:ReturnType<typeof setTimeout>|undefined;
const pending=new Map<number,{resolve:(data:Buffer)=>void;reject:(error:Error)=>void}>();
function reader(){
 if(worker)return worker;
 const child=spawn('python3',['-B',path.join(projectRoot,'tools/assets/source.py'),'--serve']);worker=child;
 let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4096);});
 const fail=(error:Error)=>{if(worker!==child)return;worker=undefined;for(const p of pending.values())p.reject(error);pending.clear();child.kill();};
 child.on('error',fail);child.on('close',code=>{if(worker===child)fail(new Error(`Asset source reader exited (${code}): ${stderr}`));});
 createInterface({input:child.stdout}).on('line',line=>{
  try{
   const result=JSON.parse(line) as {id:number;data?:string;error?:string},request=pending.get(result.id);
   if(!request)return;pending.delete(result.id);
   if(result.error!==undefined)request.reject(new Error(result.error));else if(typeof result.data==='string')request.resolve(Buffer.from(result.data,'base64'));else request.reject(new Error('Invalid asset source response'));
   if(!pending.size)idle=setTimeout(()=>{if(worker===child&&!pending.size){worker=undefined;child.stdin.end();}},500);
  }catch(error){fail(error instanceof Error?error:new Error(String(error)));child.kill();}
 });
 child.stdin.on('error',fail);
 return child;
}
export function readLibrarySource(member:string,group='ink-collection-01',location?:{root:string;indexPath:string}):Promise<Buffer>{
 safeRelative(member);safeRelative(group);if(idle)clearTimeout(idle);
 const root=location?.root??sourceLibrary(),child=reader(),requestId=++id;
 return new Promise((resolve,reject)=>{
  pending.set(requestId,{resolve,reject});
  child.stdin.write(JSON.stringify({id:requestId,root,index:location?.indexPath??indexPath,group,member})+'\n');
 });
}
export function sourceGroup(base:string){const prefix='references/art/';if(!base.startsWith(prefix))throw new Error(`Unknown source root: ${base}`);return safeRelative(base.slice(prefix.length));}
