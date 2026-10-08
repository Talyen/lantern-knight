import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {AssetCache} from './assets/cache';
import {verificationIdentity,requireStableInputs} from './verification';
import {runProcess} from './run-process';
import {acquireCommandLane} from './command-lane';

export async function runChecks(root:string,run:(name:string,args:string[])=>Promise<void>,local=false){
 const before=await verificationIdentity(root),steps:{name:string;status:'passed'|'failed'|'skipped';reason?:string}[]=[];
 const commands:[string,string[]][]=[['typecheck',['run','typecheck']],['repository',['run','repo:check']],['architecture',['run','architecture:check']],['documentation',['run','docs:check']],['tests',['test',...(local?['--','--local']:[])]],['assets',['run','assets:check',...(local?['--','--local']:[])]],['whitespace',[]]];
 let failed=false;
 for(const [name,args] of commands){
  if(failed){steps.push({name,status:'skipped',reason:'earlier check failed'});continue;}
  try{await run(name,args);steps.push({name,status:'passed'});}catch(error){steps.push({name,status:'failed',reason:String(error)});failed=true;}
 }
 try{await requireStableInputs(root,before);steps.push({name:'source stability',status:'passed'});}catch(error){steps.push({name:'source stability',status:'failed',reason:String(error)});failed=true;}
 return {source:before,steps,passed:!failed};
}
async function main(){
 const args=process.argv.slice(2);if(args.some(arg=>arg!=='--local')||args.length>1)throw new Error('Use npm run check [-- --local]. The handoff always runs all regular gates.');
 const root=fileURLToPath(new URL('../',import.meta.url)),lane=await acquireCommandLane({cwd:root,command:'check'+(args.length?' --local':'')});
 try{await check(root,args,lane.env);}finally{await lane.release();}
}
async function check(root:string,args:string[],env:NodeJS.ProcessEnv){
 const cache=new AssetCache(),held=await cache.lease('diagnostics-'+randomUUID(),8*1024*1024);let log='',current='';
 try{
  const result=await runChecks(root,async(name,args)=>{
   current=name;
   const command=name==='whitespace'?'git':process.execPath;
   const argv=name==='whitespace'?['diff','--check']:[process.env.npm_execpath??path.join(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js'),...args];
   console.log(`Checking ${name}…`);
   let output='';
   try{await runProcess(command,argv,{cwd:root,env,timeoutMs:5*60*1000,output:chunk=>{output=(output+chunk.toString()).slice(-1024*1024);}});if(name==='tests'){const totals=output.split('\n').find(line=>/^\d+ suites?; \d+ checks passed; \d+ failed\.$/.test(line));if(totals)console.log(totals);}}
   catch(error){console.error(output.slice(-4000));throw error;}
   finally{log=(log+`\n${name}\n${output}`).slice(-4*1024*1024);}

  },args.includes('--local'));
  console.log(result.steps.map(step=>`${step.status.toUpperCase()}: ${step.name}${step.reason?' — '+step.reason:''}`).join('\n'));
  console.log('Local evidence only; hosted CI and visible playtesting have separate ownership.');
  if(!result.passed){await fs.writeFile(path.join(held.root,'check.json'),JSON.stringify(result,null,2));await fs.writeFile(path.join(held.root,'check.log'),log);console.error('Failure diagnostics: '+held.root);process.exitCode=1;}
  else await fs.rm(held.root,{recursive:true,force:true});
 }catch(error){await fs.writeFile(path.join(held.root,'check.log'),`${current}\n${log}\n${String(error)}`);console.error('Failure diagnostics: '+held.root);throw error;}
 finally{await held.release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
