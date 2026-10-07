import {smokeLaunch} from './smoke-launch';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Vector3,OrthographicCamera} from 'three';
import {content,heightAt} from '../src/content/world';
import type {GameSave} from '../src/core/save';
import {extractFile} from '@electron/asar';
const run=await smokeLaunch(false),{app,page,output,errors}=run;const checks:string[]=[];
// Aim against the package's own calibration, even while another chat edits content.
const archive=process.platform==='darwin'?path.resolve(path.dirname(run.executable),'../Resources/app.asar'):path.join(path.dirname(run.executable),'resources/app.asar');
const identity=JSON.parse(extractFile(archive,'dist/build-identity.json').toString());
try{
 await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true',{},{timeout:45000});
 await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0]!.setContentSize(1920,1080);});
 assert.equal(await page.evaluate(()=>('foundation' in window)),false);assert.equal(await page.locator('#lab').count(),0);assert.equal(await page.locator('#game-walk-blend').count(),0);assert.equal(await page.locator('[data-mode]').count(),0);assert.equal(await page.evaluate(()=>typeof window.lantern?.launchMode),'undefined');checks.push('player package has no inspection API, labs, mode controls or development launch bridge');
 const capture=async(name:string)=>{if(run.capture)await page.screenshot({path:path.join(output,`${name}.png`)});};
 const resume=async()=>{if(await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Resume',exact:true}).click();await page.locator('canvas').focus();};
 const observe=async()=>{if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();await page.getByRole('button',{name:'Save checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint saved');return JSON.parse(await fs.readFile(path.join(run.profile,'saves/game.json'),'utf8')) as GameSave;};
 let save=await observe();assert.equal(save.area,'court');assert.equal(Object.keys(save.areas.court!.actors).length,1);assert.equal(save.areas.court!.engaged,false);
 await resume();await capture('approach-opening');await page.waitForTimeout(1700);save=await observe();assert.equal(save.player.health,100);assert.equal(save.areas.court!.engaged,false);checks.push('opening grants a quiet approach with one dormant skeleton');
 const moveTo=async(x:number,z:number)=>{
  let startingArea:string|undefined;
  for(let i=0;i<24;i++){save=await observe();if(startingArea&&save.area!==startingArea)return;startingArea??=save.area;const dx=x-save.player.x,dz=z-save.player.z,d=Math.hypot(dx,dz);if(d<.25)return;
   const sx=(dx-dz)/Math.sqrt(2),sy=(-dx-dz)/Math.sqrt(2),keys:string[]=[];if(Math.abs(sx)>.15*d)keys.push(sx>0?'KeyD':'KeyA');if(Math.abs(sy)>.15*d)keys.push(sy>0?'KeyW':'KeyS');
   await resume();for(const key of keys)await page.keyboard.down(key);await page.waitForTimeout(Math.min(650,d/1.8*1000));for(const key of keys)await page.keyboard.up(key);
   if(await page.locator('#room-title').textContent()!=='Graveyard Approach'&&save.area==='court')return;
  }
  throw new Error(`unable to reach (${x},${z}) using player controls`);
 };
 const aimWorld=async(x:number,z:number,value:GameSave,button:'left'|'right'='left')=>{const rect=await page.locator('canvas').boundingBox();assert.ok(rect);
  const snapshot=identity.rendering;assert.ok(snapshot,'package rendering calibration is required');const definition=snapshot.areas[value.area],area={...content.area(value.area),surface:definition.surface},f=definition.camera,h=value.player;
  const t=f.arrival?Math.max(0,Math.min(1,(h.z-f.arrival.start)/(f.arrival.end-f.arrival.start))):0,bz=f.bias.z+(f.arrival?f.arrival.biasZ-f.bias.z:0)*t;
  const framed={x:Math.max(f.bounds.minX,Math.min(f.bounds.maxX,h.x+f.bias.x)),z:Math.max(f.bounds.minZ,Math.min(f.bounds.maxZ,h.z+bz))},target=new Vector3(framed.x,heightAt(area,framed.x,framed.z),framed.z),half=snapshot.camera.verticalSpan/2,aspect=rect.width/rect.height,camera=new OrthographicCamera(-half*aspect,half*aspect,half,-half,.1,100),a=snapshot.camera.azimuthDeg*Math.PI/180,e=snapshot.camera.elevationDeg*Math.PI/180;
  camera.position.copy(target).addScaledVector(new Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)),30);camera.lookAt(target);camera.updateMatrixWorld();const q=new Vector3(x,heightAt(area,x,z),z).project(camera);await page.mouse.click(rect.x+(q.x+1)*rect.width/2,rect.y+(1-q.y)*rect.height/2,{button});};
 const fight=async()=>{for(let i=0;i<12;i++){save=await observe();const state=save.areas[save.area]!;if(state.cleared)return;if(!state.engaged){await moveTo(0,2);save=await observe();}
  const alive=Object.values(save.areas[save.area]!.actors).filter(a=>a.health>0).sort((a,b)=>Math.hypot(a.x-save.player.x,a.z-save.player.z)-Math.hypot(b.x-save.player.x,b.z-save.player.z)),enemy=alive[0]!;
  await resume();if(save.player.cooldown===0){await aimWorld(enemy.x,enemy.z,save,'right');await page.waitForTimeout(520);}
  // Repeated player clicks keep the short input buffer alive through hurt/recovery.
  for(let strike=0;strike<12;strike++){await aimWorld(enemy.x,enemy.z,save);await page.waitForTimeout(110);}
 }throw new Error('encounter did not clear through player combat controls');};
 await moveTo(0,.8);await fight();save=await observe();assert.equal(save.areas.court!.cleared,true);checks.push('single skeleton encounter clears through mouse combat controls');await resume();await capture('approach-cleared');
 await moveTo(0,-5.95);await page.waitForFunction(()=>document.querySelector('#room-title')?.textContent==='Ruined Chapel',{},{timeout:15000});save=await observe();assert.equal(save.area,'upper-landing');assert.equal(Object.keys(save.areas['upper-landing']!.actors).length,2);assert.equal(save.areas['upper-landing']!.engaged,false);const healthAfterFirst=save.player.health;
 await resume();await capture('chapel-opening');await moveTo(0,8.3);await page.waitForFunction(()=>document.querySelector('#room-title')?.textContent==='Graveyard Approach');save=await observe();assert.ok(save.areas.court!.cleared);assert.equal(save.areas['upper-landing']!.engaged,false);assert.equal(save.player.health,healthAfterFirst);await moveTo(0,-5.95);await page.waitForFunction(()=>document.querySelector('#room-title')?.textContent==='Ruined Chapel');save=await observe();assert.deepEqual(Object.values(save.areas['upper-landing']!.actors).map(a=>a.health),[50,50]);checks.push('retreat is available before chapel clear and a revisit retains the quiet two-enemy encounter');await moveTo(0,2.0);await resume();await capture('nave');await fight();save=await observe();assert.ok(save.areas['upper-landing']!.cleared);checks.push('player enters the closed chapel passage, carrying health into the two-skeleton encounter');await resume();await page.waitForTimeout(850);await capture('chapel-cleared');await moveTo(0,-5.5);await resume();await capture('altar');
 await page.keyboard.down('Shift');await page.keyboard.down('KeyS');await page.waitForTimeout(150);await page.keyboard.up('KeyS');await page.keyboard.up('Shift');save=await observe();assert.ok(save.player.dodgeCooldown>0);const frozen=await fs.readFile(path.join(run.profile,'saves/game.json'));await page.waitForTimeout(300);assert.deepEqual(await fs.readFile(path.join(run.profile,'saves/game.json')),frozen);checks.push('dodge cooldown is saveable and pause freezes the checkpoint');
 await page.getByRole('button',{name:'Load checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint loaded');save=await observe();assert.ok(save.areas.court!.cleared&&save.areas['upper-landing']!.cleared);checks.push('normal UI save/load retains both cleared encounters');
 await page.getByRole('button',{name:'Reset encounter',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#objective')?.textContent==='Approach the altar'&&document.querySelector('#hp')?.textContent?.trim().startsWith('100'));await resume();await moveTo(0,2.0);await resume();await page.waitForFunction(()=>!document.querySelector('#hp')?.textContent?.trim().startsWith('100'),{},{timeout:20000});await page.waitForFunction(()=>document.querySelector('#hp')?.textContent?.trim().startsWith('100'),{},{timeout:35000});save=await observe();assert.equal(save.player.health,100);assert.equal(save.areas['upper-landing']!.engaged,false);assert.deepEqual(Object.values(save.areas['upper-landing']!.actors).map(a=>a.health),[50,50]);assert.ok(save.areas.court!.cleared);assert.ok(Math.abs(save.player.z-7.5)<.01);checks.push('player death recreates the current encounter at its safe entry while preserving the cleared graveyard');await resume();await capture('chapel-death-reset');
 if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();
 await page.locator('#zoom-span').selectOption('13');await page.locator('#render-scale').selectOption('0.75');
 await page.waitForFunction(async()=>{const result=await window.lantern!.loadSettings();return (result.status==='ok'||result.status==='recovered')&&result.data.verticalSpan===13&&result.data.renderScale===.75;});
 await page.reload();await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true',{},{timeout:60000});
 if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();
 assert.equal(await page.locator('#zoom-span').inputValue(),'13');assert.equal(await page.locator('#render-scale').inputValue(),'0.75');checks.push('camera distance and render scale save immediately and survive reload');
 assert.deepEqual(errors,[]);await fs.rm(path.join(output,'failure.json'),{force:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,healthAfterFirst,save,platform:process.platform,limitations:['Package verification covers this host; visible display pacing is unverified.']},null,2));console.log(`PASS: ${checks.length} Game checks; ${run.capture?output:'verified; successful diagnostics discarded'}`);
}catch(error){let checkpoint:unknown;try{await page.screenshot({path:path.join(output,'failure.png')});if(!await page.locator('#modal').isVisible())await page.getByRole('button',{name:'Pause / save'}).click();await page.getByRole('button',{name:'Save checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint saved');checkpoint=JSON.parse(await fs.readFile(path.join(run.profile,'saves/game.json'),'utf8'));}catch{}await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),errors,checks,checkpoint},null,2));throw error;}finally{await run.close();}
