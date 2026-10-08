import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {selectTestFiles} from '../tools/test';
import {checkDocumentation} from '../tools/check-docs';
import {checkArchitecture} from '../tools/check-architecture';
import {reviewDiff} from '../tools/review-diff';
import {AssetCache} from '../tools/assets/cache';
import {execFileSync} from 'node:child_process';
import {verificationIdentity,requireStableInputs,acquireTestLane,guardedBuild} from '../tools/verification';
import {runChecks} from '../tools/check';
import {runProcess} from '../tools/run-process';

test('handoff cannot certify changed inputs and reports unrun gates after failure',async()=>{
 const f=await fixture();try{
  const executed:string[]=[];
  const success=await runChecks(f.root,async name=>{executed.push(name);});assert.equal(success.passed,true);assert.equal(executed.length,7);assert.ok(success.steps.every(step=>step.status==='passed'));
  const failed=await runChecks(f.root,async name=>{if(name==='tests')throw new Error('consequential regression');});assert.equal(failed.passed,false);assert.deepEqual(failed.steps.filter(s=>s.status==='skipped').map(s=>s.name),['assets','whitespace']);
  const changed=await runChecks(f.root,async name=>{if(name==='tests')await f.write('tests/new.test.ts','export const changed=1;');});assert.equal(changed.passed,false);assert.equal(changed.steps.at(-1)!.name,'source stability');
  const before=await verificationIdentity(f.root);await fs.mkdir(path.join(f.root,'dist'));await f.write('dist/output.json','{}');await requireStableInputs(f.root,before);
  await f.write('.env.local','LANTERN_TEST_VALUE=changed');await assert.rejects(requireStableInputs(f.root,before),/Source inputs changed/);
 }finally{await f.close();}
});
test('source guard catches same-size tracked edits, deletion and untracked inputs without following links',async()=>{
 const f=await fixture();try{
  const git=(args:string[])=>execFileSync('git',args,{cwd:f.root,stdio:'pipe'});git(['init','--quiet']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);await f.write('tests/input.test.ts','one');git(['add','.']);git(['commit','--quiet','-m','fixture']);
  const before=await verificationIdentity(f.root);await f.write('tests/input.test.ts','two');await assert.rejects(requireStableInputs(f.root,before),/Source inputs changed/);
  await f.write('tests/input.test.ts','one');await requireStableInputs(f.root,before);await fs.rm(path.join(f.root,'tests/input.test.ts'));await assert.rejects(requireStableInputs(f.root,before),/Source inputs changed/);
  await f.write('tests/input.test.ts','one');await f.write('tools-new.ts','new');await assert.rejects(requireStableInputs(f.root,before),/Source inputs changed/);
  if(process.platform!=='win32'){await fs.symlink(path.join(f.root,'package.json'),path.join(f.root,'linked.json'));await assert.rejects(verificationIdentity(f.root),/cannot follow symlink/);}
 }finally{await f.close();}
});
test('test lane rejects an overlapping owner and becomes available after release',async()=>{
 const first=await acquireTestLane(0),port=first.port;
 try{await assert.rejects(acquireTestLane(port,{waitMs:0,report:()=>{}}),/lane is occupied/);}finally{await first.release();}
 const next=await acquireTestLane(port);await next.release();await next.release();
});
test('failed or stale builds remove verification stamps, including an earlier successful stamp',async()=>{
 const f=await fixture();try{
  await fs.mkdir(path.join(f.root,'dist'));const stamp=path.join(f.root,'dist/build-identity.json');
  await guardedBuild(f.root,stamp,async inputs=>{await fs.writeFile(stamp,JSON.stringify(inputs));});assert.ok(await fs.stat(stamp));
  await assert.rejects(guardedBuild(f.root,stamp,async()=>{throw new Error('build failed');}),/build failed/);await assert.rejects(fs.stat(stamp),{code:'ENOENT'});
  await assert.rejects(guardedBuild(f.root,stamp,async inputs=>{await fs.writeFile(stamp,JSON.stringify(inputs));await f.write('tests/new.test.ts','changed');}),/Source inputs changed/);await assert.rejects(fs.stat(stamp),{code:'ENOENT'});
 }finally{await f.close();}
});
test('command deadlines fail and reap the owned child before returning',async()=>{
 let output='';await assert.rejects(runProcess(process.execPath,['-e','console.log(process.pid);setInterval(()=>{},1000)'],{cwd:process.cwd(),timeoutMs:500,output:chunk=>{output+=chunk.toString();}}),/deadline exceeded/);
 const pid=Number(output.trim());assert.ok(pid>0);assert.throws(()=>process.kill(pid,0),(error:NodeJS.ErrnoException)=>error.code==='ESRCH');
});

async function fixture(){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-tooling-')),root=path.join(temporary,'repo');
 await fs.mkdir(path.join(root,'tests'),{recursive:true});await fs.mkdir(path.join(root,'docs'));
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node test',build:'node build','docs:check':'node docs'}}));
 return {root,write:(file:string,text:string)=>fs.writeFile(path.join(root,file),text),close:()=>fs.rm(temporary,{recursive:true,force:true})};
}
test('test selection defaults to every suite and explicit paths select only the named suites',async()=>{
 const f=await fixture();try{
  await f.write('tests/second.test.ts','');await f.write('tests/first.test.ts','');await f.write('tests/helper.ts','');
  assert.deepEqual(await selectTestFiles([],f.root),['tests/first.test.ts','tests/second.test.ts']);
  assert.deepEqual(await selectTestFiles(['./tests/second.test.ts',path.join(f.root,'tests/second.test.ts')],f.root),['tests/second.test.ts']);
  for(const invalid of ['tests/missing.test.ts','tests','--unknown','tests/helper.ts','../first.test.ts','tests/*.test.ts'])await assert.rejects(selectTestFiles(['tests/first.test.ts',invalid],f.root),/Invalid test selection/);
  await fs.rm(path.join(f.root,'tests/first.test.ts'));await fs.rm(path.join(f.root,'tests/second.test.ts'));await assert.rejects(selectTestFiles([],f.root),/No test suites/);
 }finally{await f.close();}
});
test('documentation rejects stale prose paths and disconnected durable guidance while allowing literals',async()=>{
 const f=await fixture();try{
  await f.write('README.md','[Guide](docs/guide.md)\n`src/missing.ts`\n```ts\n// `src/example.ts`\n```\n');
  await f.write('docs/guide.md','# Guide\n[Related](related.md)\n');await f.write('docs/related.md','# Related\n');await f.write('docs/orphan.md','# Orphan\n');
  const files=['README.md','docs/guide.md','docs/related.md','docs/orphan.md'];
  const findings=await checkDocumentation(f.root,files);assert.equal(findings.length,2);assert.ok(findings.some(f=>f.includes('src/missing.ts')));assert.ok(findings.some(f=>f.includes('docs/orphan.md: durable document')));
  await f.write('README.md','[Guide](docs/guide.md)\n[Other](docs/orphan.md)\n');assert.deepEqual(await checkDocumentation(f.root,files),[]);
 }finally{await f.close();}
});
test('native parsed boundaries reject type/export/dynamic/desktop edges without treating comments as imports',async()=>{
 const f=await fixture();try{
  for(const dir of ['src/core','src/content','src/presentation','electron','tools'])await fs.mkdir(path.join(f.root,dir),{recursive:true});
  await f.write('tsconfig.json',JSON.stringify({compilerOptions:{module:'esnext',moduleResolution:'bundler',types:[]},include:['src','electron','tools']}));
  await f.write('src/presentation/view.ts','export type V = {}; export const view=1;');await f.write('src/content/rules.ts','export const rules=1;');
  await f.write('electron/main.ts','export const desktop=1;');await f.write('tools/check.ts','export const check=1;');
  await f.write('src/core/case.ts',[
   "import type {V} from '../presentation/view';","export {desktop} from '../../electron/main';","type P=import('../presentation/view').V;",
   "const later=()=>import('../../tools/check');","const disk=require('node:fs');","const computed=(name:string)=>import(name);",
   "import {rules} from '../content/rules';","// import '../../electron/ignored';",'const text="import node:ignored";',
  ].join('\n'));
  const findings=await checkArchitecture(f.root,['src/core/case.ts']);assert.equal(findings.length,6,findings.join('\n'));assert.ok(findings.some(f=>f.includes('literal target')));assert.ok(findings.every(f=>!f.includes('ignored')&&!f.includes('rules')));
  await f.write('src/core/case.ts',"import {rules} from '../content/rules'; export {rules};");assert.deepEqual(await checkArchitecture(f.root,['src/core/case.ts']),[]);
 }finally{await f.close();}
});
test('review retains staged reversals, renames, deletions and untracked paths outside selected patches',async()=>{
 const f=await fixture();try{
  const git=(args:string[])=>execFileSync('git',args,{cwd:f.root,encoding:'utf8'});
  git(['init','--quiet']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
  await f.write('reverse.txt','original\n');await f.write('old name.txt','renamed\n');await f.write('deleted.txt','delete me\n');git(['add','.']);git(['commit','--quiet','-m','fixture']);
  await f.write('reverse.txt','staged\n');git(['add','reverse.txt']);await f.write('reverse.txt','original\n');git(['mv','old name.txt','new name.txt']);await fs.unlink(path.join(f.root,'deleted.txt'));await f.write('new file.txt','new work\n');
  const cache=new AssetCache(path.join(path.dirname(f.root),'cache'));
  const selected=await reviewDiff(f.root,['reverse.txt'],{cache}),report=await fs.readFile(selected.report,'utf8');
  assert.equal(selected.entries.length,4);assert.ok(report.includes('new file.txt'));assert.ok(report.includes('deleted.txt'));assert.ok(report.includes('old name.txt'));assert.equal((report.match(/diff --git/g)??[]).length,2);assert.ok(report.includes('+staged'));assert.ok(report.includes('+original'));
  const full=await reviewDiff(f.root,[],{cache});assert.ok((await fs.readFile(full.report,'utf8')).includes('+new work'));assert.ok((await fs.readFile(full.report,'utf8')).includes('rename to new name.txt'));
  await assert.rejects(reviewDiff(f.root,['../'],{cache}),/inside the checkout/);await assert.rejects(reviewDiff(f.root,['unknown'],{cache}),/no changes/);
 }finally{await f.close();}
});
test('documentation checks catch broken paths, heading anchors and npm commands together',async()=>{
 const f=await fixture();try{
  await f.write('docs/target.md','# Existing\n');
  await f.write('README.md','[Missing](docs/missing.md)\n[Wrong heading](docs/target.md#absent)\n`npm run missing`\n[Undefined][absent]\n');
  const findings=await checkDocumentation(f.root,['README.md']);
  assert.equal(findings.length,4);assert.ok(findings.some(f=>f.includes('target does not exist')));assert.ok(findings.some(f=>f.includes('heading anchor does not exist')));assert.ok(findings.some(f=>f.includes('unknown npm script missing')));assert.ok(findings.some(f=>f.includes('undefined Markdown link reference')));
 }finally{await f.close();}
});
test('documentation links respect duplicate headings, references, encoded paths and literal examples',async()=>{
 const f=await fixture();try{
  await f.write('docs/target.md','# Save / load\n## Save / load\n## Save / load-1\n~~~md\n## Fake\n~~~\n');
  await f.write('docs/a file(1).txt','target');
  await f.write('README.md','# Main\n[Self](#main)\n[First](docs/target.md#save--load)\n[Duplicate][SAVE]\n[Collision](docs/target.md#save--load-1-1)\n[Space](docs/a%20file(1).txt)\n[Angle](<docs/a file(1).txt>)\n[save]: docs/target.md#save--load-1\n`[Literal](missing.md)`\n```md\n[Literal](missing.md)\nnpm run docs:check\n```\n<!-- [Comment](missing.md) npm run absent -->\n[Remote](https://example.com#unverified)\n');
  assert.deepEqual(await checkDocumentation(f.root,['README.md']),[]);
  await f.write('../outside.md','# Private\nnpm run absent\n');
  await f.write('README.md','[Fake](docs/target.md#fake)\n[Outside](../outside.md)\n');
  const findings=await checkDocumentation(f.root,['README.md','../outside.md']);
  assert.equal(findings.length,3);assert.equal(findings.filter(f=>f.includes('outside the repository')).length,2);assert.ok(findings.every(f=>!f.includes('unknown npm script')));
 }finally{await f.close();}
});
