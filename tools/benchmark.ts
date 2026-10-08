import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {option,type smokeLaunch} from './smoke-launch';
import {digest,sourceIdentity} from './source-identity';

const pair=z.tuple([z.number().positive(),z.number().positive()]);
export const BenchmarkSchema=z.object({
 schemaVersion:z.literal(1),recordedAt:z.string(),source:z.object({commit:z.string(),dirty:z.boolean(),sha256:z.string(),assetSha256:z.string()}),
 build:z.object({sourceCommit:z.string().nullable(),dirty:z.boolean(),sha256:z.string()}),
 environment:z.object({hardware:z.string().min(1),os:z.string(),arch:z.string(),runtime:z.record(z.string(),z.string()),flags:z.array(z.string()),gpu:z.string(),webgl:z.string(),refreshHz:z.number().nonnegative(),visible:z.boolean(),viewport:pair,buffer:pair,dpr:z.number().positive(),scenario:z.literal('opening-loop-v1'),warmupMs:z.number().nonnegative(),assets:z.string().regex(/^[a-f0-9]{64}$/),settings:z.record(z.string(),z.unknown())}).strict(),
 requestedMs:z.number().positive(),frames:z.array(z.number().finite().positive()).min(30).max(100000),droppedMs:z.number().nonnegative(),simulatedTicks:z.number().int().nonnegative(),
}).strict();
export type BenchmarkRecord=z.infer<typeof BenchmarkSchema>;
export function frameSummary(frames:number[]){
 if(frames.length<30||frames.some(n=>!Number.isFinite(n)||n<=0))throw new Error('Benchmark requires at least 30 finite positive frame gaps');
 const sorted=[...frames].sort((a,b)=>a-b),durationMs=frames.reduce((a,b)=>a+b,0);
 const percentile=(p:number)=>sorted[Math.ceil(sorted.length*p)-1]!;
 return {frames:frames.length,durationMs,fps:frames.length*1000/durationMs,p95Ms:percentile(.95),p99Ms:percentile(.99),hitchesPer30s:frames.filter(n=>n>=50).length*30000/durationMs,stallsPer30s:frames.filter(n=>n>=100).length*30000/durationMs};
}
export function compareBenchmarks(first:unknown,second:unknown){
 const baseline=BenchmarkSchema.parse(first),candidate=BenchmarkSchema.parse(second);
 if(!baseline.environment.refreshHz||!candidate.environment.refreshHz||[baseline,candidate].some(r=>r.environment.gpu==='unavailable'))throw new Error('Comparison requires available refresh-rate and GPU observations');
 const differing=(Object.keys(baseline.environment) as (keyof BenchmarkRecord['environment'])[]).filter(key=>digest(baseline.environment[key])!==digest(candidate.environment[key]));
 if(differing.length)throw new Error('Incompatible benchmark conditions: '+differing.join(', '));
 const before=frameSummary(baseline.frames),after=frameSummary(candidate.frames);
 return {before,after,delta:{p95Ms:after.p95Ms-before.p95Ms,p99Ms:after.p99Ms-before.p99Ms,hitchesPer30s:after.hitchesPer30s-before.hitchesPer30s,stallsPer30s:after.stallsPer30s-before.stallsPer30s},limitations:['Frame callback cadence is not GPU present timing or proof of visual parity.','Repeat matching observations; one comparison does not establish a performance improvement.']};
}
export async function captureBenchmark(run:Awaited<ReturnType<typeof smokeLaunch>>){
 const bounded=(name:string,fallback:string,min:number,max:number)=>{const value=Number(option(name,fallback));if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${name} must be between ${min} and ${max}`);return value;};
 const warmupMs=bounded('--warmup-ms','2000',0,30000),requestedMs=bounded('--duration-ms','10000',1000,60000),source=await sourceIdentity(process.cwd());
 const loaded=await run.app.evaluate(({app})=>{
  // Playwright evaluates in a VM without a dynamic-import callback. Node's
  // builtin accessor also retains Electron's ASAR-aware filesystem behavior.
  const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path');
  return JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'dist-dev/build-identity.json'),'utf8')) as {sourceCommit:string|null;dirty:boolean;assets:{sha256:string};files:Record<string,string>};
 });
 if(!loaded.assets?.sha256||loaded.assets.sha256!==(process.env.LANTERN_ASSET_SHA256??source.assetSha256))throw new Error('Benchmark package asset identity differs; rebuild/package Dev with the selected pack');
 const environment=async()=>{
  const desktop=await run.app.evaluate(({BrowserWindow,screen})=>{const window=BrowserWindow.getAllWindows()[0]!;return {arch:process.arch,refreshHz:screen.getDisplayMatching(window.getBounds()).displayFrequency,visible:window.isVisible(),runtime:{node:process.versions.node!,electron:process.versions.electron!,chromium:process.versions.chrome!},flags:process.argv.filter(a=>/^--(?:use-|disable-gpu)/.test(a))};});
  const rendering=await run.page.evaluate(()=>{const p=window.foundation.presentation,s=p.stats();return {viewport:[s.logical[0]!,s.logical[1]!] as [number,number],buffer:[s.buffer[0]!,s.buffer[1]!] as [number,number],dpr:s.devicePixelRatio,gpu:String(s.gpu),webgl:String(s.webgl),settings:{renderScale:s.renderScale,verticalSpan:s.verticalSpan,animationTreatment:s.animationTreatment,stabilized:s.stabilized,walkTiming:s.walkTiming,rigidSword:s.rigidSword,depthOfField:p.depthOfField,visualEffects:p.visualEffects,lighting:p.lookRenderer.settings}};});
  return {...desktop,...rendering,hardware:option('--hardware',os.hostname()+' / '+(os.cpus()[0]?.model??'unknown CPU')),os:`${os.platform()} ${os.release()}`,scenario:'opening-loop-v1' as const,warmupMs,assets:loaded.assets.sha256};
 };
 await run.page.evaluate(()=>window.foundation.startBenchmark());await run.page.waitForTimeout(warmupMs);
 const before=await environment();await run.page.evaluate(()=>window.foundation.beginBenchmarkMeasurement());await run.page.waitForTimeout(requestedMs);
 const result=await run.page.evaluate(()=>window.foundation.finishBenchmark(false)),after=await environment();
 assert.equal(digest(before),digest(after),'benchmark settings/display changed during measurement');assert.deepEqual(await sourceIdentity(process.cwd()),source,'source changed during benchmark');
 const record=BenchmarkSchema.parse({schemaVersion:1,recordedAt:new Date().toISOString(),source,build:{sourceCommit:loaded.sourceCommit,dirty:loaded.dirty,sha256:digest(loaded.files)},environment:before,requestedMs,frames:result.frames,droppedMs:result.droppedMs,simulatedTicks:result.simulatedTicks});
 const output=path.join(run.output,'benchmark.json');await fs.writeFile(output,JSON.stringify(record));
 console.log(`Benchmark: ${JSON.stringify(frameSummary(record.frames))}\nComparison input: ${output}`);return record;
}
async function main(){
 const args=process.argv.slice(2);if(args.length!==2||args.some(a=>a.startsWith('--')))throw new Error('Use benchmark:compare -- <baseline.json> <candidate.json>');
 const read=async(file:string)=>{if((await fs.stat(file)).size>16*1024*1024)throw new Error('Benchmark input exceeds 16 MiB');return JSON.parse(await fs.readFile(file,'utf8'));};
 const first=await read(args[0]!),second=await read(args[1]!);
 const compare=first.schemaVersion===2||second.schemaVersion===2?(await import('./game-benchmark')).compareGameBenchmarks:compareBenchmarks;
 console.log(JSON.stringify(compare(first,second),null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
