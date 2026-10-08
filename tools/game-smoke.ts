import {startGameBenchmark} from './game-benchmark';
import {option,smokeLaunch} from './smoke-launch';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Vector3,OrthographicCamera} from 'three';
import {content,heightAt} from '../src/content/world';
import type {GameSave} from '../src/core/save';
import {extractFile} from '@electron/asar';
const benchmark=process.argv.includes('--benchmark');
const run=await smokeLaunch(false,process.argv.includes('--software')?['--use-gl=angle','--use-angle=swiftshader']:[],{retain:benchmark}),{app,page,output,errors}=run;const checks:string[]=[];
// Aim against the package's own calibration, even while another chat edits content.
const archive=process.platform==='darwin'?path.resolve(path.dirname(run.executable),'../Resources/app.asar'):path.join(path.dirname(run.executable),'resources/app.asar');
try{
 const identity=JSON.parse(extractFile(archive,'dist/build-identity.json').toString());
 await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true',{},{timeout:45000});
 const renderer=await page.evaluate(()=>{const gl=document.querySelector('canvas')!.getContext('webgl2')!,info=gl.getExtension('WEBGL_debug_renderer_info');return info?String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)):'unavailable';});console.log('Game renderer: '+renderer);
 await app.evaluate(({BrowserWindow},benchmark)=>{BrowserWindow.getAllWindows()[0]!.setContentSize(benchmark?2560:1280,benchmark?1440:800);},benchmark);
 assert.equal(await page.evaluate(()=>('foundation' in window)),false);assert.equal(await page.locator('#lab').count(),0);assert.equal(await page.locator('#game-walk-blend').count(),0);assert.equal(await page.locator('[data-mode]').count(),0);assert.equal(await page.evaluate(()=>typeof window.lantern?.launchMode),'undefined');checks.push('player package has no inspection API, labs, mode controls or development launch bridge');
 const capture=async(name:string)=>{if(run.capture)await page.screenshot({path:path.join(output,`${name}.png`)});};
 const resume=async()=>{if(await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Resume',exact:true}).click();await page.locator('canvas').focus();};
 const observe=async()=>{if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();await page.getByRole('button',{name:'Save checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint saved');return JSON.parse(await fs.readFile(path.join(run.profile,'saves/game.json'),'utf8')) as GameSave;};
 // Interaction checks use the player's existing quality setting on software-rendered CI.
 if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();
 await page.locator('#render-scale').selectOption(benchmark?option('--render-scale','1'):'0.5');
 let save=await observe();assert.equal(save.area,'court');assert.equal(Object.keys(save.areas.court!.actors).length,1);assert.equal(save.areas.court!.engaged,false);
 const measurement=benchmark?await startGameBenchmark(run,save):undefined;await measurement?.phase('approach');
 await resume();await capture('approach-opening');await page.waitForTimeout(1700);save=await observe();assert.equal(save.player.health,100);assert.equal(save.areas.court!.engaged,false);checks.push('opening grants a quiet approach with one dormant skeleton');
 const renderedFrames=async()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const moveTo=async(x:number,z:number)=>{
  let startingArea:string|undefined;
  for(let i=0;i<24;i++){save=await observe();if(startingArea&&save.area!==startingArea)return;startingArea??=save.area;const dx=x-save.player.x,dz=z-save.player.z,d=Math.hypot(dx,dz);if(d<.1)return;
   const sx=(dx-dz)/Math.sqrt(2),sy=(-dx-dz)/Math.sqrt(2),keys:string[]=[];if(Math.abs(sx)>.15*d)keys.push(sx>0?'KeyD':'KeyA');if(Math.abs(sy)>.15*d)keys.push(sy>0?'KeyW':'KeyS');
   await resume();for(const key of keys)await page.keyboard.down(key);await page.waitForTimeout(Math.min(650,d/1.8*1000));await renderedFrames();for(const key of keys)await page.keyboard.up(key);
   if(await page.locator('#room-title').textContent()!=='Graveyard Approach'&&save.area==='court')return;
  }
  throw new Error(`unable to reach (${x},${z}) using player controls`);
 };
 const aimWorld=async(x:number,z:number,value:GameSave,button:'left'|'right'='left')=>{const rect=await page.locator('canvas').boundingBox();assert.ok(rect);
  const snapshot=identity.rendering;assert.ok(snapshot,'package rendering calibration is required');const definition=snapshot.areas[value.area],area={...content.area(value.area),surface:definition.surface},f=definition.camera,h=value.player;
  const t=f.arrival?Math.max(0,Math.min(1,(h.z-f.arrival.start)/(f.arrival.end-f.arrival.start))):0,bz=f.bias.z+(f.arrival?f.arrival.biasZ-f.bias.z:0)*t;
  const half=(snapshot.camera.verticalSpan+(snapshot.camera.verticalSpan===9?(f.arrival?.span??9)-9:0)*t*t*(3-2*t))/2,aspect=rect.width/rect.height,a=snapshot.camera.azimuthDeg*Math.PI/180,e=snapshot.camera.elevationDeg*Math.PI/180;
  const framed={x:Math.max(f.bounds.minX,Math.min(f.bounds.maxX,h.x+f.bias.x)),z:Math.max(f.bounds.minZ,Math.min(f.bounds.maxZ,h.z+bz))};
  if(f.keepHeroVisible){
   const c=Math.cos(a),s=Math.sin(a),sine=Math.sin(e),lateral=(h.x-framed.x)*c-(h.z-framed.z)*s,limit=Math.max(.1,half*aspect-.75),shift=lateral-Math.max(-limit,Math.min(limit,lateral));
   framed.x+=shift*c;framed.z-=shift*s;
   const targetHeight=(f.targetHeight??0)+((f.arrival?.targetHeight??f.targetHeight??0)-(f.targetHeight??0))*t;
   const vertical=-((h.x-framed.x)*s+(h.z-framed.z)*c)*sine-targetHeight*Math.cos(e),low=-half+.6,high=half-snapshot.camera.heroHeight*Math.cos(e)-.6,correction=vertical-Math.max(low,Math.min(high,vertical));
   framed.x-=correction*s/sine;framed.z-=correction*c/sine;
  }
  const target=new Vector3(framed.x,heightAt(area,framed.x,framed.z)+((f.targetHeight??0)+((f.arrival?.targetHeight??f.targetHeight??0)-(f.targetHeight??0))*t),framed.z),camera=new OrthographicCamera(-half*aspect,half*aspect,half,-half,.1,100);
  camera.position.copy(target).addScaledVector(new Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)),30);camera.lookAt(target);camera.updateMatrixWorld();const q=new Vector3(x,heightAt(area,x,z),z).project(camera);await page.mouse.click(rect.x+(q.x+1)*rect.width/2,rect.y+(1-q.y)*rect.height/2,{button});};
 const fight=async()=>{for(let i=0;i<12;i++){
  save=await observe();let state=save.areas[save.area]!;if(state.cleared)return;
  if(save.player.health===0){await resume();await page.waitForFunction(()=>document.querySelector('#hp')?.textContent?.trim().startsWith('100'),{},{timeout:120000});continue;}
  if(!state.engaged){await moveTo(0,2);save=await observe();state=save.areas[save.area]!;}
  const targets=Object.values(state.actors).filter(a=>a.health>0).sort((a,b)=>Math.hypot(a.x-save.player.x,a.z-save.player.z)-Math.hypot(b.x-save.player.x,b.z-save.player.z));
  // Use the same defensive controls available to a player when surrounded.
  if(save.player.dodgeCooldown===0&&Math.hypot(targets[0]!.x-save.player.x,targets[0]!.z-save.player.z)<1.6){
   const away=targets.reduce((v,a)=>{const dx=save.player.x-a.x,dz=save.player.z-a.z,d=Math.max(.1,dx*dx+dz*dz);return {x:v.x+dx/d,z:v.z+dz/d};},{x:0,z:0});
   const sx=(away.x-away.z)/Math.sqrt(2),sy=(-away.x-away.z)/Math.sqrt(2),keys=[sx>0?'KeyD':'KeyA',sy>0?'KeyW':'KeyS'];
   await resume();for(const key of keys)await page.keyboard.down(key);
   for(let attempt=0;attempt<4;attempt++){await page.keyboard.down('Shift');await renderedFrames();await page.keyboard.up('Shift');if(await page.locator('#dodge-status').textContent()!=='Shift · ready')break;}
   await page.waitForFunction(()=>{const text=document.querySelector('#dodge-status')?.textContent??'';return text==='Shift · ready'||Number.parseFloat(text)<=.3;},{},{timeout:120000});
   for(const key of keys)await page.keyboard.up(key);save=await observe();
  }
  const alive=Object.values(save.areas[save.area]!.actors).filter(a=>a.health>0).sort((a,b)=>Math.hypot(a.x-save.player.x,a.z-save.player.z)-Math.hypot(b.x-save.player.x,b.z-save.player.z));
  if(!alive.length)return;const enemy=alive[0]!;
  await resume();if(save.player.cooldown===0){await aimWorld(enemy.x,enemy.z,save,'right');await renderedFrames();}
  // Each click reaches a rendered simulation update rather than coalescing in a
  // blocked renderer event queue. The short gameplay input buffer is unchanged.
  for(let strike=0;strike<12;strike++){await aimWorld(enemy.x,enemy.z,save);await page.waitForTimeout(110);await renderedFrames();}
 }throw new Error('encounter did not clear through player combat controls');};

 await measurement?.phase('graveyard-combat');
 await moveTo(0,.8);await fight();save=await observe();assert.equal(save.areas.court!.cleared,true);checks.push('single skeleton encounter clears through mouse combat controls');console.log('Game journey: graveyard encounter cleared');await resume();await capture('approach-cleared');
 await measurement?.phase('area-traversal');
 await moveTo(0,-5.95);await page.waitForFunction(()=>document.querySelector('#room-title')?.textContent==='Ruined Chapel',{},{timeout:15000});save=await observe();assert.equal(save.area,'upper-landing');assert.equal(Object.keys(save.areas['upper-landing']!.actors).length,2);assert.equal(save.areas['upper-landing']!.engaged,false);const healthAfterFirst=save.player.health;
 await resume();await capture('chapel-opening');await moveTo(0,8.3);await page.waitForFunction(()=>document.querySelector('#room-title')?.textContent==='Graveyard Approach');save=await observe();assert.ok(save.areas.court!.cleared);assert.equal(save.areas['upper-landing']!.engaged,false);assert.equal(save.player.health,healthAfterFirst);await moveTo(0,-5.95);await page.waitForFunction(()=>document.querySelector('#room-title')?.textContent==='Ruined Chapel');save=await observe();assert.deepEqual(Object.values(save.areas['upper-landing']!.actors).map(a=>a.health),[50,50]);checks.push('retreat is available before chapel clear and a revisit retains the quiet two-enemy encounter');await measurement?.phase('chapel-combat');await moveTo(0,2.0);await resume();await capture('nave');await fight();save=await observe();assert.ok(save.areas['upper-landing']!.cleared);checks.push('player enters the closed chapel passage, carrying health into the two-skeleton encounter');await resume();await page.waitForTimeout(850);await capture('chapel-cleared');await moveTo(0,save.player.z);await moveTo(0,-5.5);await resume();await capture('altar');
 await measurement?.phase('checkpoint');
 await page.keyboard.down('Shift');await page.keyboard.down('KeyS');await page.waitForTimeout(150);await page.keyboard.up('KeyS');await page.keyboard.up('Shift');save=await observe();assert.ok(save.player.dodgeCooldown>0);const frozen=await fs.readFile(path.join(run.profile,'saves/game.json'));await page.waitForTimeout(300);assert.deepEqual(await fs.readFile(path.join(run.profile,'saves/game.json')),frozen);checks.push('dodge cooldown is saveable and pause freezes the checkpoint');
 await page.getByRole('button',{name:'Load checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint loaded');save=await observe();assert.ok(save.areas.court!.cleared&&save.areas['upper-landing']!.cleared);checks.push('normal UI save/load retains both cleared encounters');console.log('Game journey: chapel combat, save and load verified');
 await measurement?.phase('death-retry');
 await page.getByRole('button',{name:'Reset encounter',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#objective')?.textContent==='Approach the altar'&&document.querySelector('#hp')?.textContent?.trim().startsWith('100'));await resume();await moveTo(0,2.0);await resume();await page.waitForFunction(()=>!document.querySelector('#hp')?.textContent?.trim().startsWith('100'),{},{timeout:20000});await page.waitForFunction(()=>document.querySelector('#hp')?.textContent?.trim().startsWith('100'),{},{timeout:process.platform==='win32'?120000:35000});save=await observe();assert.equal(save.player.health,100);assert.equal(save.areas['upper-landing']!.engaged,false);assert.deepEqual(Object.values(save.areas['upper-landing']!.actors).map(a=>a.health),[50,50]);assert.ok(save.areas.court!.cleared);assert.ok(Math.abs(save.player.z-7.5)<.01);checks.push('player death recreates the current encounter at its safe entry while preserving the cleared graveyard');await resume();await capture('chapel-death-reset');
 await measurement?.finish();
 if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();
 await page.locator('#zoom-span').selectOption('13');await page.locator('#render-scale').selectOption('0.75');
 await page.waitForFunction(async()=>{const result=await window.lantern!.loadSettings();return (result.status==='ok'||result.status==='recovered')&&result.data.verticalSpan===13&&result.data.renderScale===.75;});
 await page.reload();await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true',{},{timeout:60000});
 if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();
 assert.equal(await page.locator('#zoom-span').inputValue(),'13');assert.equal(await page.locator('#render-scale').inputValue(),'0.75');checks.push('camera distance and render scale save immediately and survive reload');
 assert.deepEqual(errors,[]);await measurement?.publish();await fs.rm(path.join(output,'failure.json'),{force:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,healthAfterFirst,save,platform:process.platform,limitations:['Package verification covers this host; visible display pacing is unverified.']},null,2));console.log(`PASS: ${checks.length} Game checks; ${run.capture?output:'verified; successful diagnostics discarded'}`);
}catch(error){let checkpoint:unknown;try{await page.screenshot({path:path.join(output,'failure.png')});if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();await page.getByRole('button',{name:'Save checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint saved');checkpoint=JSON.parse(await fs.readFile(path.join(run.profile,'saves/game.json'),'utf8'));}catch{}await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),errors,checks,checkpoint},null,2));throw error;}finally{await run.close();}
