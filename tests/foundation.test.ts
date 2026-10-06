import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Vector3} from 'three';
import {makeCamera,resizeCamera,groundPoint,selectDirection,screenMovement,trimmedBounds,calibrationFixture} from '../src/core/camera';
import {Animator,frameAt} from '../src/core/animation';
import {Simulation,FixedClock} from '../src/core/simulation';
import {tuning} from '../src/content/gameplay';
import {parseSource,parseManifest,type Clip} from '../src/assets/schema';
import {compile,exactSource,paddedPixels} from '../tools/compiler';
import {ResourcePool} from '../src/assets/loader';
import {Store,validateRequest} from '../electron/store';
import {parseGame} from '../src/core/save';
import {resourcePath,trustedSender} from '../electron/security';
const approx=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const source=await read('staging/fixtures/valid.json');
const manifest=await read('public/generated/manifest.json');
test('camera projection/unprojection accounts for canvas offset and both aspect ratios',()=>{
  const camera=makeCamera(16/9);for(const [width,height] of [[2560,1440],[1200,900]]){resizeCamera(camera,width!,height!);const rect={left:103,top:78,width:width!,height:height!};for(const p of [new Vector3(1,0,2),new Vector3(-3,0,-2),new Vector3()]){const ndc=p.clone().project(camera),q=groundPoint(camera,rect.left+(ndc.x+1)/2*rect.width,rect.top+(1-ndc.y)/2*rect.height,rect)!;approx(q.x,p.x);approx(q.z,p.z);}approx(camera.top-camera.bottom,12);}
  const fixture=calibrationFixture();assert.ok(fixture.headings[1]!.screenVector[1]!>0);assert.ok(fixture.headings[5]!.screenVector[1]!<0);assert.equal(fixture.view.length,16);
});
test('trim placement preserves every source pixel relative to the foot; heading wrap, ties and screen movement',()=>{
  const a={density:192,anchor:[192,348]},b=trimmedBounds(a,[30,70,200,270]);approx(b.left,(30-192)/192);approx(b.top,(348-70)/192);approx(b.left+70/192,(100-192)/192);
  assert.equal(selectDirection(-Math.PI/4),'d315');assert.equal(selectDirection(Math.PI*2),'d00');assert.equal(selectDirection(Math.PI/8),'d45');assert.equal(selectDirection(Math.PI/8+.01,'d00'),'d00');assert.throws(()=>selectDirection(NaN));const v=screenMovement(1,1);approx(Math.hypot(v.x,v.z),1);assert.ok(screenMovement(0,1).x<0);
});
test('valid and deliberately invalid schema fixtures; production fails closed',async()=>{
  parseSource(source);for(const name of ['invalid-duration','invalid-camera','invalid-heading'])assert.throws(()=>parseSource(JSON.parse(requireText(name))));
  function requireText(name:string){return fixtureTexts[name]!;}
  assert.throws(()=>parseSource(source,true),/production/);const duplicate=structuredClone(source);duplicate.frames.push(duplicate.frames[0]);assert.throws(()=>parseSource(duplicate),/duplicate/);
  const invalid=structuredClone(manifest);invalid.frames[0].rect[2]=99999;assert.throws(()=>parseManifest(invalid),/bounds/);invalid.frames[0].rect[2]=1;invalid.frames[0].rotated=true;assert.throws(()=>parseManifest(invalid));
  const nonFinite=structuredClone(source);nonFinite.asset.density=Infinity;assert.throws(()=>parseSource(nonFinite));
});
const fixtureTexts:Record<string,string>={};for(const name of ['invalid-duration','invalid-camera','invalid-heading'])fixtureTexts[name]=await fs.readFile(`staging/fixtures/${name}.json`,'utf8');
test('compiler is byte deterministic; failed build preserves prior manifest; source confinement and case',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-compiler-'));try{const a=await compile('fixtures/valid.json',dir);const before=await fs.readFile(path.join(dir,'manifest.json'));const b=await compile('fixtures/valid.json',dir);assert.equal(a.hash,b.hash);assert.deepEqual(await fs.readFile(path.join(dir,'manifest.json')),before);
    await assert.rejects(compile('fixtures/invalid-duration.json',dir));assert.deepEqual(await fs.readFile(path.join(dir,'manifest.json')),before);await assert.rejects(exactSource('../package.json'));await assert.rejects(exactSource('Fixtures/valid.json'),/case/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('edge RGB dilation preserves alpha and extrusion avoids black halo at silhouette',()=>{
  const pixels=Buffer.from([0,0,0,0,255,100,30,255,0,0,0,0]);const padded=paddedPixels(pixels,3,1);const index=(4*padded.width+4)*4;assert.deepEqual([...padded.data.subarray(index,index+4)],[255,100,30,0]);
});
const clip:Clip={frames:['a','b','c'],durationsMs:[100,50,150],loop:true,notifies:[{id:'step',atMs:80,kind:'footstep'},{id:'swing',atMs:150,kind:'whoosh'}]};
test('notifies survive skipped frames/loops, have unique identities, interruption restarts; scrub silent; death holds',()=>{
  const a=new Animator('hero',clip);assert.equal(a.advance(650).length,4);assert.equal(a.advance(0).length,0);const log=a.advance(150);assert.equal(log.length,2);assert.equal(new Set(log.map(e=>e.key)).size,2);a.seek(120);assert.equal(a.advance(1).length,0);a.start(clip);assert.ok(a.advance(100)[0]!.key.includes(':1:0:'));assert.equal(frameAt({...clip,loop:false},5000),'c');
  const b=new Animator('other',clip);b.advance(120);assert.notEqual(a.frame,b.frame);assert.equal(a.time,100);
});
test('fixed command replay matches across render cadences; catch-up bounded and pause reset discards debt',()=>{
  const replay=(cadence:number)=>{const s=new Simulation(2),clock=new FixedClock();for(let t=0;t<3000-1e-5;t+=cadence)clock.advance(Math.min(cadence,3000-t),()=>s.step({move:{x:s.tick<90?1:0,z:0},aim:{x:0,z:0},attack:s.tick%40===0,ability:s.tick===110,dodge:s.tick===60}));return s;};
  const a=replay(1000/30),b=replay(1000/144);assert.equal(a.tick,180);assert.deepEqual(a,b);const c=new FixedClock();let ticks=0;c.advance(20000,()=>ticks++);assert.equal(ticks,6);assert.ok(c.droppedMs>19000);c.reset();approx(c.accumulator,0);
});
test('sword hits each target once in active window; visual drawings never determine hit timing',()=>{
  const s=new Simulation();s.actors=s.actors.slice(0,2);Object.assign(s.hero,{x:0,z:1,px:0,pz:1});Object.assign(s.actors[1]!,{x:0,z:0,px:0,pz:0});const target=s.actors[1]!;
  for(let i=0;i<20;i++)s.step({move:{x:0,z:0},aim:{x:0,z:0},attack:i===0});assert.equal(target.health,tuning.enemy.maxHealth-tuning.attack.damage);assert.equal(s.hero.hitIds.length,1);assert.equal(s.hero.state,'attack');
});
test('dodge windows, ability cooldown, death interruption and action restart',()=>{
  const s=new Simulation();s.step({move:{x:1,z:0},aim:{x:1,z:0},dodge:true});assert.equal(s.hero.state,'dodge');const health=s.hero.health;s.damage(s.actors[1]!,s.hero,20);assert.equal(s.hero.health,health);
  s.hero.age=tuning.dodge.invulnerableEnd;s.damage(s.actors[1]!,s.hero,20);assert.equal(s.hero.state,'hurt');s.start(s.hero,'ability');s.hero.cooldown=tuning.ability.cooldown;const action=s.hero.action;s.damage(s.actors[1]!,s.hero,1000);assert.equal(s.hero.state,'death');s.step({move:{x:1,z:1},aim:{x:0,z:0},attack:true});assert.equal(s.hero.state,'death');assert.ok(s.hero.action>action);
  const alive=new Simulation();alive.step({move:{x:0,z:0},aim:{x:0,z:0},ability:true});assert.equal(alive.hero.cooldown,180);for(let i=0;i<40;i++)alive.step({move:{x:0,z:0},aim:{x:0,z:0},ability:true});assert.ok(alive.hero.cooldown>0);assert.notEqual(alive.hero.state,'ability');
});
test('shared async resources deduplicate, cancellation cannot resurrect discarded room, retries and settled lifetime',async()=>{
  let finish!:(v:{id:number})=>void,loads=0,disposed=0;
  const pool=new ResourcePool(async()=>{loads++;return new Promise<{id:number}>(r=>finish=r);},()=>disposed++);
  const signal=new AbortController(),first=pool.acquire(['hero'],signal.signal),second=pool.acquire(['hero']);signal.abort();finish({id:1});await assert.rejects(first,/cancelled/);const current=await second;assert.equal(loads,1);assert.equal(disposed,0);current.release();current.release();assert.equal(disposed,1);assert.equal(pool.entries.size,0);
  const stale=pool.acquire(['hero'],signal.signal);await assert.rejects(stale,/cancelled/);assert.equal(loads,1);
  const cancelled=new AbortController(),pending=pool.acquire(['hero'],cancelled.signal);cancelled.abort();finish({id:2});await assert.rejects(pending);assert.equal(disposed,2);
  let fail=true;const retry=new ResourcePool(async()=>{if(fail)throw new Error('missing');return{id:3};},()=>{});await assert.rejects(retry.acquire(['x']));fail=false;const recovered=await retry.acquire(['x']);recovered.release();assert.equal(retry.entries.size,0);
  for(let i=0;i<10;i++){const lease=await retry.acquire(['shared']);lease.release();}assert.equal(retry.entries.size,0);
});
test('save migration, newer format rejection, serialized writes, corruption recovery and no automatic overwrite',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-save-'));const store=new Store(dir),value=parseGame({version:0,seed:142,wins:1});
  try{assert.equal((await store.load('game')).status,'empty');await Promise.all([store.save('game',value),store.save('game',{...value,wins:2})]);const loaded=await store.load('game');assert.ok('data'in loaded);assert.equal((loaded.data as typeof value).wins,2);
    await fs.writeFile(path.join(dir,'game.json'),'corrupt');assert.equal((await store.load('game')).status,'recovered');await store.save('game',{...value,wins:3});assert.equal(await fs.readFile(path.join(dir,'game.corrupt'),'utf8'),'corrupt');
    await fs.writeFile(path.join(dir,'game.json'),'new unreadable');await fs.writeFile(path.join(dir,'game.bak'),'also unreadable');assert.equal((await store.load('game')).status,'unreadable');await assert.rejects(store.save('game',value));assert.equal(await fs.readFile(path.join(dir,'game.json'),'utf8'),'new unreadable');
    assert.throws(()=>parseGame({...value,version:99}));assert.throws(()=>validateRequest('game',{...value,extra:'x'.repeat(20000)}));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('IPC sender checks and protocol constrain origin, frame, slot, payload, extensions and traversal',()=>{
  assert.equal(trustedSender('lantern://app/index.html',true,1,1),true);assert.equal(trustedSender('https://evil.test',true,1,1),false);assert.equal(trustedSender('lantern://app/index.html',false,1,1),false);
  assert.equal(resourcePath('lantern://app/index.html','/app/dist'),'/app/dist/index.html');for(const url of ['lantern://other/index.html','lantern://app/%2e%2e%2fsecret.json','lantern://app/package.exe','lantern://app/%5csecret.json'])assert.throws(()=>resourcePath(url,'/app/dist'));assert.throws(()=>validateRequest('settings',{version:1,renderScale:3,showDebug:false}));
});
