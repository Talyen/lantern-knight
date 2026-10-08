import {run} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {inspect} from 'node:util';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AssetCache} from './assets/cache';
import {availableParallelism} from 'node:os';
import {acquireTestLane,verificationIdentity,requireStableInputs} from './verification';

export async function selectTestFiles(args:string[],root=process.cwd()){
 const available=(await fs.readdir(path.join(root,'tests'),{withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith('.test.ts')).map(entry=>'tests/'+entry.name).sort();
 if(!available.length)throw new Error('No test suites found.');
 if(!args.length)return available;
 const selected=args.map(arg=>{
  const relative=path.relative(root,path.resolve(root,arg)).split(path.sep).join('/');
  if(!available.includes(relative))throw new Error(`Invalid test selection: ${arg}. Supply an existing tests/<name>.test.ts file.`);
  return relative;
 });
 return [...new Set(selected)];
}

async function main(){
 const files=await selectTestFiles(process.argv.slice(2)),scope=`${files.length} suite${files.length===1?'':'s'}`;
 const lane=await acquireTestLane();
 try{
 const before=await verificationIdentity(process.cwd());
 console.log(`Running ${scope}: ${files.join(', ')}`);
 let passed=0,failed=0,details='';
 for await(const event of run({files,execArgv:['--import','tsx'],concurrency:Math.min(2,availableParallelism()),timeout:120000,signal:AbortSignal.timeout(5*60*1000)})){
  if(event.type==='test:pass')passed++;
  if(event.type==='test:fail'){failed++;const message=inspect(event.data.details.error,{depth:4,maxArrayLength:20,maxStringLength:2000});if(failed<=5)console.error(`${event.data.name}: ${message.slice(0,3000)}`);details+=(event.data.name+'\n'+message+'\n').slice(0,32768);}
  if(event.type==='test:stderr'||event.type==='test:stdout')details=(details+event.data.message).slice(-1024*1024);
 }
 await requireStableInputs(process.cwd(),before);
 console.log(`${scope}; ${passed} checks passed; ${failed} failed.`);
 if(failed){const cache=new AssetCache(),held=await cache.lease('diagnostics-'+randomUUID(),2*1024*1024);try{await fs.writeFile(path.join(held.root,'tests.log'),details.slice(-1024*1024));console.error('Failure diagnostics: '+path.join(held.root,'tests.log'));}finally{await held.release();}process.exitCode=1;}
 }finally{await lane.release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
