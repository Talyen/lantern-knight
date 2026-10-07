import {repositoryFinding} from '../tools/check-repository';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import {AssetCache,diskBytes} from '../tools/assets/cache';
import {makeArchive,ensurePack,inspectArchive,validatePack,recipeHash} from '../tools/assets/pack';
import {retainedPacks,obsoleteReleases} from '../tools/assets/retention';
import {publishPrepared} from '../tools/assets';
import {safeRelative} from '../tools/assets/paths';

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-packs-')),source=path.join(root,'source'),archive=path.join(root,'pack.tar.gz');
 await fs.mkdir(path.join(source,'public'),{recursive:true});await fs.mkdir(path.join(source,'metadata'));await fs.writeFile(path.join(source,'public/page.png'),'unchanged texture');await fs.writeFile(path.join(source,'metadata/receipt.json'),'{}');
 const lock=await makeArchive(source,archive,await recipeHash()),body=await fs.readFile(archive),cache=new AssetCache(path.join(root,'cache'),256*1024);
 return {root,source,archive,lock,body,cache,close:()=>fs.rm(root,{recursive:true,force:true})};
}
test('prepared archives are deterministic; fresh downloads verify every file and work offline',async()=>{
 const f=await fixture();try{
  const second=path.join(f.root,'second.tar.gz');assert.deepEqual(await makeArchive(f.source,second,f.lock.recipeSha256),f.lock);assert.deepEqual(await fs.readFile(second),f.body);
  let downloads=0;const request=(async()=>{downloads++;return new Response(f.body);}) as typeof fetch;
  const held=await ensurePack(f.lock,f.cache,request);await validatePack(held.root,f.lock);await held.release();
  const offline=await ensurePack(f.lock,f.cache,(async()=>{throw new Error('offline');}) as typeof fetch);assert.equal(downloads,1);await offline.release();
 }finally{await f.close();}
});
test('corrupt caches are repaired by pinned bytes; active users are protected',async()=>{
 const f=await fixture();try{
  const request=(async()=>new Response(f.body)) as typeof fetch,held=await ensurePack(f.lock,f.cache,request);await fs.writeFile(path.join(held.root,'public/page.png'),'tampered');
  await assert.rejects(ensurePack(f.lock,f.cache,request),/in use/);await held.release();
  const repaired=await ensurePack(f.lock,f.cache,request);assert.equal(await fs.readFile(path.join(repaired.root,'public/page.png'),'utf8'),'unchanged texture');await repaired.release();
 }finally{await f.close();}
});
test('a rewritten cache inventory cannot bless changed asset bytes',async()=>{
 const f=await fixture();try{const held=await ensurePack(f.lock,f.cache,(async()=>new Response(f.body)) as typeof fetch);const file=path.join(held.root,'pack.json'),data=JSON.parse(await fs.readFile(file,'utf8'));data.files['public/page.png'].bytes=1;await fs.writeFile(file,JSON.stringify(data));await assert.rejects(validatePack(held.root,f.lock),/inventory hash/);await held.release();}finally{await f.close();}
});
test('bad and interrupted downloads do not become usable packs or leave partial payloads',async()=>{
 const f=await fixture();try{
  for(const request of [(async()=>new Response('wrong bytes')) as typeof fetch,(async()=>new Response(null,{status:404})) as typeof fetch,(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));c.error(new Error('interrupted'));}}))) as typeof fetch])await assert.rejects(ensurePack(f.lock,f.cache,request));
  const entry=path.join(f.cache.root,'entries','pack-'+f.lock.sha256);assert.equal((await fs.readdir(entry)).filter(n=>n.startsWith('.download')||n.startsWith('.incoming')).length,0);await assert.rejects(fs.access(path.join(entry,'pack.json')));
 }finally{await f.close();}
});
test('archive links, traversal and oversized extraction are rejected before installation',async()=>{
 const f=await fixture();try{
  await assert.rejects(inspectArchive(f.archive,1),/budget/);
  await fs.symlink(path.join(f.root,'outside'),path.join(f.source,'public/link'));const bad=path.join(f.root,'link.tar.gz');await tar.c({cwd:f.source,file:bad},['public/link','pack.json']);await assert.rejects(inspectArchive(bad),/links/);
  for(const name of ['../escape','/absolute','C:/drive','public/../escape','public\\escape'])assert.throws(()=>safeRelative(name));
 }finally{await f.close();}
});
test('cache reservations evict unused data, protect active work and enforce the total budget',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-budget-')),cache=new AssetCache(root,8192);
 try{
  const old=await cache.lease('old',3000);await fs.writeFile(path.join(old.root,'data'),Buffer.alloc(3000));await old.release();
  const active=await cache.lease('active',3000);await fs.writeFile(path.join(active.root,'data'),Buffer.alloc(3000));
  const next=await cache.lease('next',4000);await assert.rejects(fs.access(old.root));await assert.rejects(cache.lease('too-big',9000),/budget/);await assert.rejects(next.reserve(6000),/protected/);await assert.rejects(cache.lease('active',0,true),/in use/);
  assert.ok(await cache.usage()<=8192);await cache.clean();await fs.access(active.root);await fs.access(next.root);await next.release();await active.release();await cache.clean();assert.ok(await diskBytes(root)<8192);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('publication does not change the pin before the public download is verified',async()=>{
 const f=await fixture();try{
  const pin=path.join(f.root,'lock.json');await fs.writeFile(pin,'previous pin');const fake={lock:f.lock,archive:f.archive,payload:f.source,held:await f.cache.lease('prepared')};
  await assert.rejects(publishPrepared(fake,async()=>JSON.stringify({assets:[{name:f.lock.filename}]}),async()=>{throw new Error('unavailable');},pin),/unavailable/);assert.equal(await fs.readFile(pin,'utf8'),'previous pin');
  await publishPrepared(fake,async()=>JSON.stringify({assets:[{name:f.lock.filename}]}),async()=>{},pin);assert.deepEqual(JSON.parse(await fs.readFile(pin,'utf8')),f.lock);await fake.held.release();
 }finally{await f.close();}
});
test('remote cleanup retains main, local and open-PR pins and fails closed on unreadable references',async()=>{
 const f=await fixture();try{
  const pin=(sha:string)=>({...f.lock,sha256:sha,releaseTag:'assets-'+sha.slice(0,16)}),main=pin('b'.repeat(64)),pr=pin('c'.repeat(64));
  const api=async(args:string[])=>{const url=args.at(-1)!;if(url.includes('/pulls?'))return JSON.stringify([[{head:{sha:'pr-head',repo:{full_name:'Talyen/lantern-knight'}}}]]);if(url.includes('/contents/'))return JSON.stringify({encoding:'base64',content:Buffer.from(JSON.stringify(url.endsWith('main')?main:pr)).toString('base64')});if(url.includes('/releases?'))return JSON.stringify([[{tag_name:f.lock.releaseTag},{tag_name:main.releaseTag},{tag_name:pr.releaseTag},{tag_name:'assets-'+'d'.repeat(16)},{tag_name:'v1.0.0'}]]);throw new Error('unexpected API');};
  const keep=await retainedPacks(f.lock,api);assert.deepEqual(await obsoleteReleases(keep,api),['assets-'+'d'.repeat(16)]);await assert.rejects(retainedPacks(f.lock,async()=>{throw new Error('unavailable');}),/unavailable/);
 }finally{await f.close();}
});

test('repository hygiene rejects raw output and oversized data while retaining explicit authored exceptions',()=>{
 for(const file of ['staging/frames.json','evidence/report.json','references/art/catalog.json','public/generated/manifest.json','docs/history/old.md','dist/assets/file.js'])assert.ok(repositoryFinding(file,10));
 assert.ok(repositoryFinding('src/data.json',64*1024+1));assert.ok(repositoryFinding('src/raw.txt',256*1024+1));assert.equal(repositoryFinding('assets/sources.json',36000),undefined);assert.equal(repositoryFinding('package-lock.json',202106),undefined);assert.equal(repositoryFinding('references/canon/image(3).png',706541),undefined);
});
