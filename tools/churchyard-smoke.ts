import {option,smokeLaunch} from './smoke-launch';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import '../src/inspection';
const run=await smokeLaunch(true),{app,page,output,errors}=run;const checks:string[]=[];
try{
 await page.waitForFunction(()=>window.foundation?.ready,{},{timeout:45000});
 const resize=async(w:number,h:number)=>{await app.evaluate(({BrowserWindow},{w,h})=>BrowserWindow.getAllWindows()[0]!.setContentSize(w,h+128),{w,h});await page.waitForFunction(w=>document.querySelector('canvas')!.clientWidth===w,w,{timeout:15000});await page.evaluate(()=>{window.foundation.presentation.resize();return new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});};
 const freeze=async()=>{await page.evaluate(()=>window.foundation.pause(true));await page.locator('#modal').evaluate(el=>(el as HTMLElement).hidden=true);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));};
 await resize(1920,1080);await freeze();
 assert.equal(await page.evaluate(()=>window.foundation.sim.enemies.length),1);assert.equal(await page.evaluate(()=>window.foundation.sim.engaged),false);assert.equal(await page.evaluate(()=>window.foundation.stats().verticalSpan),9);checks.push('one dormant skeleton and close camera at opening');
 if(run.capture)await page.locator('canvas').screenshot({path:path.join(output,'approach-opening.png')});
 await page.evaluate(()=>window.foundation.fixture('upper-landing'));await freeze();assert.equal(await page.evaluate(()=>window.foundation.sim.enemies.length),2);if(run.capture)await page.locator('canvas').screenshot({path:path.join(output,'chapel-opening.png')});
 if(!process.argv.includes('--quick')){
  for(const area of (option('--area','both')==='both'?['court','upper-landing']:[option('--area','both')])){
   await page.evaluate(area=>window.foundation.fixture(area),area);await freeze();
   for(const [aspect,w,h]of (process.argv.includes('--ci')?[['16x9',1920,1080] as const]:[['4x3',1440,1080],['16x9',1920,1080],['ultrawide',2520,1080]] as const)){await resize(w,h);
    for(const span of (process.argv.includes('--ci')?[9,15]:[9,11,13,15])){
     await page.evaluate(span=>{window.foundation.presentation.verticalSpan=span;window.foundation.presentation.resize();},span);
     const positions=area==='court'?[['spawn',-2.2,6.65],['combat',.4,1.5],['stairs',0,-5.4],['exit',0,-6.0],['west',-6.1,0],['east',6.1,0],['north',0,-5.8],['south',0,7.6],['nw',-6.1,-5.8],['ne',6.1,-5.8],['sw',-6.1,7.6],['se',6.1,7.6]] as const:[['spawn',0,7.5],['combat',0,1],['altar',0,-5.5],['exit',0,8.3],['west',-7.3,0],['east',7.3,0],['north',0,-8.1],['south',0,8.3],['nw',-7.3,-8.1],['ne',7.3,-8.1],['sw',-7.3,8.3],['se',7.3,8.3]] as const;
     for(const [position,x,z]of positions){
      await page.evaluate(({x,z})=>{const f=window.foundation,h=f.sim.hero;Object.assign(h,{x,z,px:x,pz:z});f.sim.move(h,0,0);h.px=h.x;h.pz=h.z;f.presentation.update(f.sim,1,0,{x:h.x,z:h.z+1});},{x,z});
      if(run.capture)await page.locator('canvas').screenshot({path:path.join(output,`${area}-${aspect}-${span}-${position}.jpg`),type:'jpeg',quality:88,scale:'css'});
      const support=await page.evaluate(()=>{const f=window.foundation,s=f.presentation.actors.get('player')!;return {root:s.sprite.mesh.position.y,height:f.sim.hero.y,shadow:s.shadow.position.y};});assert.ok(Math.abs(support.root-support.height)<1e-6);assert.ok(Math.abs(support.shadow-support.height-.03)<1e-6);
     }
    }
   }
  }
  checks.push('requested scene/camera/aspect matrix at spawn, combat, stairs, exits, edges and corners; supported roots/shadows');
  for(const area of ['court','upper-landing']){await page.evaluate(area=>window.foundation.fixture(area),area);await freeze();await resize(2560,1440);if(run.capture)await page.locator('canvas').screenshot({path:path.join(output,`${area}-1440p.png`),scale:'css'});await resize(3840,2160);await page.evaluate(()=>{window.foundation.presentation.verticalSpan=11;window.foundation.presentation.resize();});if(run.capture)await page.locator('canvas').screenshot({path:path.join(output,`${area}-4k.png`),scale:'css'});const buffer=await page.evaluate(()=>window.foundation.stats().buffer);assert.equal(buffer[0],3840);assert.ok(buffer[1]!>=1800&&buffer[1]!<=2160);}
  const resources=[];for(let i=0;i<6;i++){await page.evaluate(()=>window.foundation.reset());await freeze();resources.push(await page.evaluate(()=>window.foundation.stats().objects));}assert.deepEqual(resources.at(-1),resources[2]);checks.push('repeated room replacement retains stable GPU resources');
  await page.getByRole('button',{name:'Animation lab',exact:true}).click();await page.locator('#asset').selectOption('ink-hero');await page.waitForFunction(()=>window.foundation.presentation.labAsset==='ink-hero');await page.locator('#clip').selectOption('walk');await page.locator('#lab-zoom').fill('300');if(run.capture)await page.locator('canvas').screenshot({path:path.join(output,'sandbox-animation.png')});checks.push('animation lab still loads the original hero walk');
  await page.getByRole('button',{name:'Encounter',exact:true}).click();await page.evaluate(()=>window.foundation.fixture('systems-fixture'));await freeze();assert.equal(await page.evaluate(()=>window.foundation.sim.enemies.length),5);checks.push('development-only fixture retains five enemies and two melee profiles');
  await page.getByRole('button',{name:'Play Opening Scene',exact:true}).click();await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true'&&!('foundation' in window));assert.equal(await page.locator('#lab').count(),0);assert.equal(await page.evaluate(()=>typeof window.lantern?.launchMode),'function');
  await page.getByRole('button',{name:'Pause / save'}).click();await page.getByRole('button',{name:'Save checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint saved');await page.getByRole('button',{name:'Return to Sandbox'}).click();await page.waitForFunction(()=>window.foundation?.ready);assert.equal((await fs.readdir(path.join(run.profile,'preview/saves'))).includes('game.json'),true);await assert.rejects(fs.stat(path.join(run.profile,'sandbox/saves/game.json')),{code:'ENOENT'});checks.push('Dev Game Preview shares player UI; mode recreation removes inspection API and keeps checkpoints out of sandbox');
 }
 if(process.argv.includes('--benchmark')){await page.evaluate(()=>window.foundation.startBenchmark());await page.waitForTimeout(10000);const result=await page.evaluate(()=>window.foundation.finishBenchmark());await fs.writeFile(path.join(output,'benchmark.json'),JSON.stringify(result,null,2));}
 assert.deepEqual(errors,[]);await fs.rm(path.join(output,'failure.json'),{force:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,stats:await page.evaluate(()=>window.foundation.stats()),platform:process.platform,limitations:['Screenshots cover this host and do not certify visible display pacing.']},null,2));console.log(`PASS: ${checks.length} Dev checks; ${run.capture?output:'verified; successful diagnostics discarded'}`);
} catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),errors,checks},null,2));throw error;}finally{await run.close();}
