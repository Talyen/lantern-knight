import fs from 'node:fs/promises';
import path from 'node:path';
import {devNull} from 'node:os';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AssetCache} from './assets/cache';

export async function reviewDiff(root:string,paths:string[]=[],options:{full?:boolean;statusOnly?:boolean;cache?:AssetCache}={}){
 const git=(args:string[],accepted=[0])=>{
  try{return execFileSync('git',['-c','core.fsmonitor=false','-c','core.untrackedCache=false','--literal-pathspecs','--no-pager',...args],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});}
  catch(error){const failure=error as {status?:number;stdout?:string};if(accepted.includes(failure.status??-1)&&typeof failure.stdout==='string')return failure.stdout;throw error;}
 };
 const selected=paths.map(p=>{const relative=path.relative(root,path.resolve(root,p)).split(path.sep).join('/');if(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))throw new Error('Review paths must remain inside the checkout');return relative;});
 const fields=git(['status','--porcelain=v1','-z','--untracked-files=all']).split('\0'),entries:{status:string;file:string;from?:string}[]=[];
 for(let i=0;i<fields.length;i++){const field=fields[i]!;if(!field)continue;const status=field.slice(0,2);entries.push({status,file:field.slice(3),...(/[RC]/.test(status)?{from:fields[++i]}:{})});}
 const matches=(entry:typeof entries[number])=>!selected.length||[entry.file,entry.from].some(name=>name!==undefined&&selected.some(p=>!p||name===p||name.startsWith(p+'/')));
 if(selected.some(p=>!entries.some(e=>[e.file,e.from].some(name=>name!==undefined&&(!p||name===p||name.startsWith(p+'/'))))))throw new Error('A selected review path has no changes; check the supplied paths');
 const inventory=entries.map(e=>`${e.status} ${JSON.stringify(e.file)}${e.from?' <- '+JSON.stringify(e.from):''}`),patches:string[]=[];
 const omitted=/(?:^|\/)package-lock\.json$|\.(?:png|jpe?g|webp|wav|mp3|mp4)$/i;
 for(const e of entries.filter(matches)){
  const label=inventory[entries.indexOf(e)]!;
  if(options.statusOnly){patches.push(label);continue;}
  if(!options.full&&[e.file,e.from].some(name=>name&&omitted.test(name))){patches.push(label+': patch omitted; inspect this particular path with --full when needed.');continue;}
  const flags=['--no-ext-diff','--no-textconv','--no-color'],names=[e.file,...(e.from?[e.from]:[])];
  const patch=e.status==='??'?git(['diff','--no-index',...flags,'--',devNull,e.file],[0,1]):git(['diff','--cached',...flags,'--',...names])+git(['diff',...flags,'--',...names]);
  patches.push(label+'\n'+(patch||'No textual patch; inspect the status.'));
  if(patches.reduce((n,p)=>n+Buffer.byteLength(p),0)>16*1024*1024)throw new Error('Review exceeds 16 MiB; select narrower paths');
 }
 const report=['Complete working-tree inventory:',...inventory,'','Selected patches/status:',...patches].join('\n')+'\n';
 const inventoryJSON=JSON.stringify(entries);
 if(Buffer.byteLength(report)+Buffer.byteLength(inventoryJSON)>16*1024*1024)throw new Error('Review exceeds 16 MiB; select narrower paths');
 const held=await (options.cache??new AssetCache()).lease('diagnostics-review-'+randomUUID(),20*1024*1024);
 try{const filename=path.join(held.root,'review.txt');await fs.writeFile(filename,report);await fs.writeFile(path.join(held.root,'inventory.json'),inventoryJSON);
  const excerpts:string[]=[];let bytes=0,hidden=0;for(const patch of patches){if(bytes+Buffer.byteLength(patch)>8000){hidden++;continue;}excerpts.push(patch);bytes+=Buffer.byteLength(patch);}
  return {entries,report:filename,text:`${entries.length} changed paths; ${entries.filter(matches).length} selected.\n${excerpts.join('\n')}\n${hidden} selected blocks omitted from terminal output. Complete inventory and selected patches: ${filename}`};
 }finally{await held.release();}
}
async function main(){const args=process.argv.slice(2);if(args.some(a=>a.startsWith('--')&&!['--full','--status'].includes(a)))throw new Error('Use [--full] [--status] [task-owned paths]');const result=await reviewDiff(fileURLToPath(new URL('../',import.meta.url)),args.filter(a=>!a.startsWith('--')),{full:args.includes('--full'),statusOnly:args.includes('--status')});console.log(result.text);}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
