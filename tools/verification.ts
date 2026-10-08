import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {acquireCommandLane} from './command-lane';

// Authored inputs only: never walk installed dependencies, packs or the library.
const inputPath=(file:string)=>! /^(?:node_modules|staging|public|dist(?:-[^/]*)?|release(?:-[^/]*)?|evidence|tmp|references\/art)\//.test(file)&&(/\.(?:[cm]?[jt]sx?|json|glsl|css|html|md|txt|ya?ml|py)$/.test(file)||/^(?:\.gitignore|\.npmrc|\.node-version|\.nvmrc|\.env(?:\..*)?)$/.test(file));
export async function verificationIdentity(root:string){
 const git=(args:string[])=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
 let commit:string|null=null,dirty=true,names:string[];
 try{const top=git(['rev-parse','--show-toplevel']).trim();if(await fs.realpath(top)!==await fs.realpath(root))throw new Error('Source archive');commit=git(['rev-parse','HEAD']).trim();names=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);dirty=!!git(['status','--porcelain']).trim();}
 catch(error){
  // An archive has no Git attribution, but still needs stable authored inputs.
  if(await fs.lstat(path.join(root,'.git')).then(()=>true,err=>{if(err.code==='ENOENT')return false;throw err;}))throw error;
  names=[];
  const walk=async(directory:string)=>{for(const entry of await fs.readdir(path.join(root,directory),{withFileTypes:true})){const file=path.posix.join(directory,entry.name);if(entry.isDirectory())await walk(file);else names.push(file);}};
  for(const entry of await fs.readdir(root,{withFileTypes:true})){if(!entry.isDirectory())names.push(entry.name);else if(['src','electron','tools','tests','authoring','docs','assets','.github'].includes(entry.name))await walk(entry.name);}
 }
 const hash=createHash('sha256');
 // Ignored root build configuration still affects the candidate. Hash only;
 // never expose environment-file contents in diagnostics.
 names.push(...(await fs.readdir(root)).filter(file=>/^\.env(?:\..*)?$|^\.npmrc$/.test(file)));
 for(const file of [...new Set(names)].filter(inputPath).sort()){
  hash.update(file+'\0');
  try{const stat=await fs.lstat(path.join(root,file));if(stat.isSymbolicLink())throw new Error(`Source identity cannot follow symlink: ${file}`);if(!stat.isFile())throw new Error(`Invalid source input: ${file}`);hash.update(String(stat.mode)+'\0');hash.update(await fs.readFile(path.join(root,file)));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;hash.update('deleted');}
  hash.update('\0');
 }
 return {commit,dirty,sha256:hash.digest('hex')};
}
export async function requireStableInputs(root:string,before:Awaited<ReturnType<typeof verificationIdentity>>){
 if(!isDeepStrictEqual(before,await verificationIdentity(root)))throw new Error('Source inputs changed during the run; rerun for the current inputs.');
}
export async function guardedBuild(root:string,stamp:string,build:(inputs:Awaited<ReturnType<typeof verificationIdentity>>)=>Promise<void>){
 await fs.rm(stamp,{force:true});
 try{const before=await verificationIdentity(root);await build(before);await requireStableInputs(root,before);}
 catch(error){await fs.rm(stamp,{force:true});throw error;}
}

// Direct test/smoke entry points participate too; managed children borrow.
export const acquireTestLane=(port=48158,options:Omit<NonNullable<Parameters<typeof acquireCommandLane>[0]>,'port'>={})=>acquireCommandLane({...options,port});
