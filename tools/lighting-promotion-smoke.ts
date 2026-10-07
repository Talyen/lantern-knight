import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {smokeLaunch} from './smoke-launch';
import '../src/inspection';
const checks:string[]=[],hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const game=await smokeLaunch(false);
try{
 const {page,app,output}=game;await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true',{},{timeout:60000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setContentSize(1920,1080));
 assert.equal(await page.evaluate(()=>('foundation' in window)),false);assert.equal(await page.locator('#lighting-lab').count(),0);
 assert.equal(await page.locator('#depth-of-field').inputValue(),'100');await page.locator('#pause').click();await page.evaluate(()=>document.querySelector<HTMLElement>('#modal')!.hidden=true);
 await page.locator('canvas').screenshot({path:path.join(output,'game-diorama-4k.png')});
 const before=await page.locator('canvas').screenshot();
 await page.locator('#depth-of-field').evaluate(input=>{(input as HTMLInputElement).value='0';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));});
 const settingsFile=path.join(game.profile,'saves/settings.json');await page.waitForFunction(()=>document.querySelector('#depth-of-field-value')?.textContent==='Off');
 for(let i=0;i<50;i++){try{if(JSON.parse(await fs.readFile(settingsFile,'utf8')).depthOfField===0)break;}catch{}await page.waitForTimeout(50);}
 assert.equal(JSON.parse(await fs.readFile(settingsFile,'utf8')).depthOfField,0);await page.waitForTimeout(100);
 const after=await page.locator('canvas').screenshot();assert.notEqual(hash(await sharp(before).raw().toBuffer()),hash(await sharp(after).raw().toBuffer()));await fs.writeFile(path.join(output,'game-dof-off-4k.png'),after);
 await page.reload();await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true');assert.equal(await page.locator('#depth-of-field').inputValue(),'0');
 await page.locator('#depth-of-field').evaluate(input=>{(input as HTMLInputElement).value='45';input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));});await page.waitForTimeout(250);await page.reload();await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true');assert.equal(await page.locator('#depth-of-field').inputValue(),'45');
 assert.equal(JSON.parse(await fs.readFile(settingsFile,'utf8')).version,4);assert.deepEqual(game.errors,[]);checks.push('player build ships shared diorama rendering without labs/inspection; DOF Off and 45% survive reload; on/off renders distinctly at 4K');
}finally{await game.close();}
const dev=await smokeLaunch(true);
try{
 const {page,app,output}=dev;await page.waitForFunction(()=>window.foundation?.ready,{},{timeout:60000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setContentSize(1920,1208));
 await page.waitForFunction(()=>window.foundation.stats().buffer[0]===3840);
 const initial=await page.evaluate(()=>window.foundation.presentation.lookRenderer.settings);assert.equal(initial.look,'diorama');assert.equal(initial.strength,1.5);
 const capture=()=>page.evaluate(()=>{const f=window.foundation,p=f.presentation;p.update(f.sim,1,0,{x:0,z:1});const c=document.createElement('canvas');c.width=p.canvas.width;c.height=p.canvas.height;c.getContext('2d')!.drawImage(p.canvas,0,0);return c.toDataURL('image/png').split(',')[1]!;});
 for(const area of ['court','upper-landing']){
  await page.evaluate(async area=>{const f=window.foundation;await f.fixture(area);f.mode('lighting');f.pause(true);document.querySelector<HTMLElement>('#modal')!.hidden=true;},area);
  for(const rig of ['golden','silver']){await page.locator('#lighting-rig').selectOption(rig);await fs.writeFile(path.join(output,`${area}-${rig}-diorama-4k.png`),Buffer.from(await capture(),'base64'));}
 }
 await page.evaluate(async()=>{const f=window.foundation;await f.fixture('court');f.mode('lighting');f.pause(true);document.querySelector<HTMLElement>('#modal')!.hidden=true;});await page.locator('#lighting-rig').selectOption('golden');
 await page.evaluate(()=>{const p=window.foundation.presentation;p.lookRenderer.setSettings({lighting:false,shadows:false,postprocessing:false,atmosphere:true});p.lookRenderer.time=0;});const still=Buffer.from(await capture(),'base64');
 await page.evaluate(()=>window.foundation.presentation.lookRenderer.time=6);const flowing=Buffer.from(await capture(),'base64');const a=await sharp(still).raw().toBuffer(),b=await sharp(flowing).raw().toBuffer();let changes=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]!-b[i]!)>1)changes++;assert.ok(changes>5000,`mist should visibly flow: ${changes} changed channels`);await fs.writeFile(path.join(output,'mist-time-0.png'),still);await fs.writeFile(path.join(output,'mist-time-6.png'),flowing);
 checks.push('mist visibly changes on a frozen scene through world-space advection');
 await page.evaluate(()=>window.foundation.mode('encounter'));assert.equal(await page.evaluate(()=>window.foundation.presentation.lookRenderer.settings.look),'diorama');assert.equal(await page.evaluate(()=>window.foundation.presentation.lookRenderer.settings.strength),1.5);
 for(const area of ['court','upper-landing']){const counts:unknown[]=[];for(let i=0;i<8;i++){await page.evaluate(async area=>{const f=window.foundation;await f.fixture(area);f.pause(true);document.querySelector<HTMLElement>('#modal')!.hidden=true;},area);await capture();counts.push(await page.evaluate(()=>window.foundation.stats().objects));}counts.forEach(c=>assert.deepEqual(c,counts[0]));}
 assert.deepEqual(dev.errors,[]);checks.push('both lighting rigs render both areas at native 4K; returning from the lab restores diorama/150%; eight replacements per area settle at identical counts');
 await fs.writeFile(path.join(output,'promotion.json'),JSON.stringify({passed:true,checks,mistChangedChannels:changes,stats:await page.evaluate(()=>window.foundation.stats()),scope:'Packaged macOS arm64, hidden WebGL2 window; Windows and visible pacing unverified.'},null,2));console.log(`PASS: ${checks.length} rendering-promotion checks`);
}finally{await dev.close();}
