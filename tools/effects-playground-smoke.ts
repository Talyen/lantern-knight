import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {smokeLaunch} from './smoke-launch';
import {effectLabels,type PlaygroundEffect} from '../src/content/effects-playground';
import type {} from '../src/effects-playground';

const run=await smokeLaunch(true,['--effects']),{page,output,errors}=run,changes:Record<string,number>={};
const capture=()=>page.evaluate(()=>{const p=window.effectsPlayground;p.render();const source=document.querySelector('canvas')!,copy=document.createElement('canvas');copy.width=source.width;copy.height=source.height;copy.getContext('2d')!.drawImage(source,0,0);return copy.toDataURL('image/png').split(',')[1]!;});
try{
 await page.waitForFunction(()=>window.effectsPlayground?.ready,{},{timeout:60000});await page.evaluate(()=>window.effectsPlayground.pause(true));
 assert.equal(await page.evaluate(()=>window.effectsPlayground.stats().antiAliasing),'SMAA 1x High');
 await page.evaluate(()=>window.effectsPlayground.setTreatment('rich'));await page.evaluate(()=>window.effectsPlayground.step(630));
 for(const key of Object.keys(effectLabels) as PlaygroundEffect[]){
  await page.evaluate(key=>window.effectsPlayground.setEffect(key,true),key);const on=Buffer.from(await capture(),'base64');
  await page.evaluate(key=>window.effectsPlayground.setEffect(key,false),key);const off=Buffer.from(await capture(),'base64');
  const a=await sharp(on).raw().toBuffer(),b=await sharp(off).raw().toBuffer();let count=0;for(let i=0;i<a.length;i++)if(Math.abs(a[i]!-b[i]!)>2)count++;
  assert.ok(count>30,`${key} should visibly change: ${count} channels`);changes[key]=count;
  if(run.capture)await fs.writeFile(path.join(output,`${key}-on.png`),on);if(run.capture)await fs.writeFile(path.join(output,`${key}-off.png`),off);await page.evaluate(key=>window.effectsPlayground.setEffect(key,true),key);
 }
 const selection=await page.evaluate(()=>window.effectsPlayground.settings.effects);await page.locator('#baseline').check();await capture();assert.deepEqual(await page.evaluate(()=>window.effectsPlayground.settings.effects),selection);
 const baseline=await capture();await page.locator('#baseline').uncheck();await capture();await page.locator('#baseline').check();assert.equal(await capture(),baseline);await page.locator('#baseline').uncheck();
 const before=await page.evaluate(()=>window.effectsPlayground.stats().time);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.effectsPlayground.stats().time),before);
 await page.evaluate(()=>window.effectsPlayground.step(400));assert.ok(await page.evaluate(()=>window.effectsPlayground.stats().time)>before);
 const counts=await page.evaluate(()=>window.effectsPlayground.stats().objects);
 for(let i=0;i<8;i++){await page.locator('#all-off').click();await capture();await page.locator('#all-on').click();await page.locator('#reset').click();await capture();}
 assert.deepEqual(await page.evaluate(()=>window.effectsPlayground.stats().objects),counts);assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:'Return to Sandbox',exact:true}).click();await page.waitForURL('lantern://app/sandbox.html');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,changes,checks:['independent developer scene','all effect toggles change rendered pixels','baseline restores exact pixels without changing selection','pause and frame-step','stable resources through replay/toggles','return to sandbox'],scope:'Packaged macOS developer app; source art and the two production scene definitions are unchanged by this work.'},null,2));
 console.log(`PASS: ${Object.keys(changes).length} visual effect comparisons and isolated lab routing`);
}catch(error){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),errors,changes},null,2));throw error;}finally{await run.close();}
