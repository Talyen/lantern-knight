import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export function digest(value:unknown):string{
 const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,item])=>[k,canonical(item)])):v;
 return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export async function sourceIdentity(root:string){
 const git=(args:string[])=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
 const files=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(f=>/^src\/.*\.(?:ts|json|glsl|css)$|^authoring\/hero-actions\.json$|^tools\/(?:session-replay|source-identity)\.ts$|^package\.json$/.test(f)))].sort();
 const hash=createHash('sha256');
 for(const file of files){hash.update(file+'\0');try{hash.update(await fs.readFile(path.join(root,file)));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;hash.update('deleted');}hash.update('\0');}
 const lock=JSON.parse(await fs.readFile(path.join(root,'assets/lock.json'),'utf8')) as {sha256:string};
 if(!/^[a-f0-9]{64}$/.test(lock.sha256))throw new Error('Invalid pinned asset identity');
 return {commit:git(['rev-parse','HEAD']).trim(),dirty:!!git(['status','--porcelain']).trim(),sha256:hash.digest('hex'),assetSha256:lock.sha256};
}
