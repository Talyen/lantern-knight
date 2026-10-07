import {smokeLaunch} from './smoke-launch';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {_electron} from 'playwright';
import sharp from 'sharp';
import {walkBlendModes,type WalkBlendMode} from '../src/core/walk-blending';
import '../src/inspection';
const launch=await smokeLaunch(true,[],{budget:1024**3}),{output,profile,executable,app,page,errors}=launch;
const asar=process.platform==='darwin'?path.resolve(path.dirname(executable),'../Resources/app.asar'):path.resolve(path.dirname(executable),'resources/app.asar');
const packageSha256=createHash('sha256').update(await fs.readFile(asar)).digest('hex');
const checks:string[]=[],modes=Object.keys(walkBlendModes) as WalkBlendMode[];
try{
 await page.waitForFunction(()=>window.foundation?.ready,{},{timeout:30000});
 assert.equal(await page.evaluate(()=>window.foundation.presentation.walkBlend),'original');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]!.setContentSize(1920,1208));
 await page.waitForFunction(()=>window.foundation.stats().buffer[0]===3840);
 await page.getByRole('button',{name:'Compare walk',exact:true}).click();
 await page.locator('#play').click();
 await page.evaluate(()=>{window.foundation.presentation.debug=false;});
 const rendered=()=>page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const seek=async(t:number)=>{await page.locator('#scrub').evaluate((input,t)=>{(input as HTMLInputElement).value=String(t);input.dispatchEvent(new Event('input',{bubbles:true}));},t);await rendered();};
 await seek(480);
 const setZoom=async(percent:number)=>{await page.locator('#lab-zoom').evaluate((input,percent)=>{(input as HTMLInputElement).value=String(percent);input.dispatchEvent(new Event('input',{bubbles:true}));},percent);await rendered();};
 const initialZoom=await page.evaluate(()=>window.foundation.stats());assert.equal(initialZoom.labZoom,2);assert.equal(initialZoom.viewSpan,5.5);
 await setZoom(400);assert.equal(await page.locator('#lab-zoom-value').textContent(),'400%');assert.equal(await page.getByRole('button',{name:'Zoom in',exact:true}).isDisabled(),true);
 const magnified=await page.evaluate(()=>{
  const p=window.foundation.presentation,canvas=p.canvas.getBoundingClientRect(),panel=document.querySelector('#lab')!.getBoundingClientRect();
  const corners=[p.labSprite,p.secondSprite].flatMap(s=>{const positions=s.geometry.getAttribute('position');return Array.from({length:positions.count},(_,i)=>{const v=s.mesh.position.clone().fromBufferAttribute(positions,i).applyMatrix4(s.mesh.matrixWorld).project(p.camera);return{x:canvas.left+(v.x+1)*canvas.width/2,y:canvas.top+(1-v.y)*canvas.height/2};});});
  return{fits:corners.every(p=>p.x>=canvas.left&&p.x<panel.left&&p.y>=canvas.top&&p.y<=canvas.bottom),time:p.labAnimator.time,span:p.viewSpan};
 });assert.equal(magnified.fits,true);assert.equal(magnified.time,480);assert.equal(magnified.span,2.75);
 await page.screenshot({path:path.join(output,'zoom-400.png'),scale:'device'});
 await page.getByRole('button',{name:'Zoom out',exact:true}).click();assert.equal(await page.locator('#lab-zoom-value').textContent(),'375%');
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert.equal(await page.locator('#lab-zoom-value').textContent(),'400%');
 await setZoom(50);assert.equal(await page.getByRole('button',{name:'Zoom out',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.foundation.stats().viewSpan),22);
 await page.locator('#lab-zoom-reset').click();await rendered();assert.equal(await page.locator('#lab-zoom-value').textContent(),'200%');
 const wheelBox=await page.locator('canvas').boundingBox();assert.ok(wheelBox);await page.mouse.move(wheelBox.x+wheelBox.width*.45,wheelBox.y+wheelBox.height*.6);
 await page.mouse.wheel(0,-120);await page.waitForFunction(()=>window.foundation.presentation.labZoom>2);
 assert.equal(await page.evaluate(()=>window.foundation.presentation.labAnimator.time),480);
 await page.locator('#lab-zoom-reset').click();await rendered();
 await page.getByRole('button',{name:'Encounter',exact:true}).click();assert.equal(await page.evaluate(()=>window.foundation.stats().viewSpan),initialZoom.verticalSpan);
 await page.mouse.wheel(0,-120);await rendered();assert.equal(await page.evaluate(()=>window.foundation.stats().viewSpan),initialZoom.verticalSpan);
 await page.getByRole('button',{name:'Animation lab',exact:true}).click();await rendered();assert.equal(await page.locator('#lab-zoom-value').textContent(),'200%');assert.equal(await page.evaluate(()=>window.foundation.presentation.labAnimator.time),480);
 checks.push('preview zoom slider, buttons, reset and wheel; 50–400% limits; centered comparison fits; paused time and gameplay framing preserved');
 // Sixteen held frames at their authored boundaries, with frozen camera/root markers.
 await page.locator('#walk-blend').selectOption('original');await page.locator('#walk-restart').click();await rendered();
 const registration=await page.evaluate(()=>{const p=window.foundation.presentation;return{frames:p.labAnimator.clip.frames,holds:p.labAnimator.clip.durationsMs,camera:p.camera.matrixWorld.toArray(),roots:[p.labSprite.mesh.position.toArray(),p.secondSprite.mesh.position.toArray()],markers:p.rootMarkers.children.map(m=>m.position.toArray())};});
 assert.equal(registration.frames.length,16);assert.equal(await page.evaluate(()=>window.foundation.presentation.rootMarkers.visible),true);
 let onset=0;
 for(let i=0;i<16;i++){
  await seek(Math.ceil(onset+.001));assert.equal(await page.evaluate(()=>window.foundation.presentation.labSprite.lastFrame),registration.frames[i]);
  await page.locator('#step').click();await rendered();assert.equal(await page.evaluate(()=>window.foundation.presentation.labSprite.lastFrame),registration.frames[(i+1)%16]);
  onset+=registration.holds[i]!;
 }
 await seek(640);await page.locator('#heading').selectOption('d135');await rendered();assert.equal(await page.evaluate(()=>window.foundation.presentation.labAnimator.time),640);
 await page.locator('#speed').selectOption('.25');await page.locator('#play').click();await page.waitForFunction(()=>window.foundation.presentation.labAnimator.time>660);await page.locator('#play').click();await rendered();
 const paused=await page.evaluate(()=>window.foundation.presentation.labAnimator.time);await rendered();assert.equal(await page.evaluate(()=>window.foundation.presentation.labAnimator.time),paused);
 assert.deepEqual(await page.evaluate(()=>{const p=window.foundation.presentation;return{camera:p.camera.matrixWorld.toArray(),roots:[p.labSprite.mesh.position.toArray(),p.secondSprite.mesh.position.toArray()],markers:p.rootMarkers.children.map(m=>m.position.toArray())};}),{camera:registration.camera,roots:registration.roots,markers:registration.markers});
 await page.locator('#speed').selectOption('1');await page.locator('#walk-restart').click();await rendered();assert.equal(await page.evaluate(()=>window.foundation.presentation.labAnimator.time),0);
 checks.push('all sixteen held frames and step boundaries including wrap; fixed visible root markers/camera; heading retains phase; quarter speed, pause and restart');
 await seek(640);
 await seek(643);
 // Capture a fixed original baseline before introducing the blending shader.
 const box=await page.locator('canvas').boundingBox();assert.ok(box);
 const clip=await page.evaluate(()=>{
  const p=window.foundation.presentation,m=p.labSprite.manifest.asset,rect=p.canvas.getBoundingClientRect(),foot=p.labSprite.mesh.position;
  const q=p.camera.quaternion,points=[[0,0],[m.canvas[0],m.canvas[1]]].map(([x,y])=>{
   const position=foot.clone();position.x+=(x!-m.anchor[0])/m.density;position.y+=(m.anchor[1]-y!)/m.density;
   const offset=position.sub(foot).applyQuaternion(q).add(foot).project(p.camera);
   return{x:rect.left+(offset.x+1)*rect.width/2,y:rect.top+(1-offset.y)*rect.height/2};
  });
  const x=Math.floor(Math.min(...points.map(p=>p.x))-12),y=Math.floor(Math.min(...points.map(p=>p.y))-12);
  return{x,y,width:Math.ceil(Math.max(...points.map(p=>p.x))-x+12),height:Math.ceil(Math.max(...points.map(p=>p.y))-y+12)};
 });
 const capture=()=>page.screenshot({clip,scale:'device'});
 const baseline=await capture(),samples:Record<string,string>={};
 for(const mode of modes){
  await page.locator('#walk-blend').selectOption(mode);await seek(643);
  assert.equal(await page.evaluate(()=>window.foundation.presentation.labAnimator.time),643);
  assert.equal(await page.locator('#game-walk-blend').inputValue(),mode);
  const comparison=await page.evaluate(()=>{const p=window.foundation.presentation;return{time:p.labAnimator.time,referenceTime:p.secondSprite.animator.time,frame:p.labSprite.lastFrame,referenceFrame:p.secondSprite.lastFrame,reference:p.secondSprite.manifest.asset.id};});
  assert.equal(comparison.time,comparison.referenceTime);assert.equal(comparison.frame,comparison.referenceFrame);assert.equal(comparison.reference,'ink-hero');
  const image=await capture();await fs.writeFile(path.join(output,`${mode}-midpoint.png`),image);samples[mode]=createHash('sha256').update(await sharp(image).raw().toBuffer()).digest('hex');
  await page.screenshot({path:path.join(output,`${mode}-comparison.png`),scale:'device'});
 }
 assert.equal(new Set(Object.values(samples)).size,modes.length,'all seven methods must produce distinct midpoint renders');
 await page.locator('#walk-blend').selectOption('original');await rendered();
 const returned=await capture();assert.deepEqual(await sharp(returned).raw().toBuffer(),await sharp(baseline).raw().toBuffer(),'Original pixels changed after enabling smoothing');
 checks.push('seven distinct methods compile and render; same-time original comparison; switching back restores exact original pixels');
 const initialObjects=await page.evaluate(()=>window.foundation.stats().objects);
 for(let i=0;i<12;i++){await page.locator('#walk-blend').selectOption(modes[i%modes.length]!);await rendered();}
 assert.deepEqual(await page.evaluate(()=>window.foundation.stats().objects),initialObjects);
 checks.push('repeated method switching does not grow GPU geometry/texture counts or restart the cycle');
 if(!process.argv.includes('--quick')){
 // Fixed actor/camera comparison: selected mode at left, uncorrected held drawings at right.
 const comparisonClip=await page.evaluate(()=>{
  const p=window.foundation.presentation,rect=p.canvas.getBoundingClientRect(),m=p.manifest.asset;
  const points=[p.labSprite,p.secondSprite].flatMap(s=>[[0,0],[m.canvas[0],m.canvas[1]]].map(([x,y])=>{
   const v=s.mesh.position.clone().addScaledVector(new (s.mesh.position.constructor as typeof import('three').Vector3)(1,0,0).applyQuaternion(p.camera.quaternion),(x!-m.anchor[0])/m.density)
    .addScaledVector(new (s.mesh.position.constructor as typeof import('three').Vector3)(0,1,0).applyQuaternion(p.camera.quaternion),(m.anchor[1]-y!)/m.density).project(p.camera);
   return{x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2};
  }));
  const x=Math.floor(Math.min(...points.map(p=>p.x))-8),y=Math.floor(Math.min(...points.map(p=>p.y))-8);
  return{x,y,width:Math.ceil(Math.max(...points.map(p=>p.x))-x+8),height:Math.ceil(Math.max(...points.map(p=>p.y))-y+8)};
 });
 const fixed=await page.evaluate(()=>{const p=window.foundation.presentation;return{camera:p.camera.matrixWorld.toArray(),roots:[p.labSprite.mesh.position.toArray(),p.secondSprite.mesh.position.toArray()],markers:p.rootMarkers.children.map(m=>m.position.toArray())};});
 const width=600,height=Math.round(comparisonClip.height/comparisonClip.width*width),gallery:string[]=[];
 for(const stabilized of [true,false]){
  await page.locator('#walk-stabilized').setChecked(stabilized);await rendered();
  assert.equal(await page.locator('#game-walk-stabilized').isChecked(),stabilized);
  for(const mode of modes){
   await page.locator('#walk-blend').selectOption(mode);const frames:Buffer[]=[];
   for(let i=0;i<50;i++){
    const pixels=await page.evaluate(({time,clip,width,height})=>{
     const f=window.foundation,p=f.presentation;p.labPaused=true;p.labAnimator.seek(time);p.labTime=time;p.update(f.sim,1,0,{x:0,z:1});
     const rect=p.canvas.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
     const ctx=canvas.getContext('2d')!;ctx.imageSmoothingQuality='high';
     ctx.drawImage(p.canvas,(clip.x-rect.left)*p.canvas.width/rect.width,(clip.y-rect.top)*p.canvas.height/rect.height,clip.width*p.canvas.width/rect.width,clip.height*p.canvas.height/rect.height,0,0,width,height);
     return canvas.toDataURL('image/png').split(',')[1]!;
    },{time:i*20,clip:comparisonClip,width,height});
    frames.push(await sharp(Buffer.from(pixels,'base64')).ensureAlpha().raw().toBuffer());
   }
   const name=`${mode}-${stabilized?'stabilized':'raw'}`;
   for(const [speed,delay] of [['normal',20],['quarter',80]] as const){
    await sharp(Buffer.concat(frames),{raw:{width,height:height*frames.length,channels:4,pageHeight:height}}).gif({loop:0,delay:Array(frames.length).fill(delay),effort:3,dither:0}).toFile(path.join(output,`${name}-${speed}.gif`));
    await sharp(Buffer.concat(frames),{raw:{width,height:height*frames.length,channels:4,pageHeight:height}}).webp({lossless:true,effort:2,loop:0,delay:Array(frames.length).fill(delay)}).toFile(path.join(output,`${name}-${speed}.webp`));
   }
   gallery.push(`<section><h2>${walkBlendModes[mode].label} · stabilization ${stabilized?'on':'off'}</h2><div><figure><img src="${name}-normal.webp"><figcaption>Normal speed</figcaption></figure><figure><img src="${name}-quarter.webp"><figcaption>Quarter speed</figcaption></figure></div></section>`);
   assert.deepEqual(await page.evaluate(()=>{const p=window.foundation.presentation;return{camera:p.camera.matrixWorld.toArray(),roots:[p.labSprite.mesh.position.toArray(),p.secondSprite.mesh.position.toArray()],markers:p.rootMarkers.children.map(m=>m.position.toArray())};}),fixed);
  }
 }
 await fs.writeFile(path.join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>16-frame walk trials</title><style>body{background:#151923;color:#eadabb;font:16px system-ui;margin:24px}section{margin:32px 0}section div{display:flex;flex-wrap:wrap;gap:16px}figure{margin:0}img{width:600px;max-width:95vw}figcaption{padding:8px}</style><h1>16-frame walk trials</h1><p>Each pair: selected mode on the left, uncorrected held drawings on the right. Green markers show fixed roots. Every preview samples the renderer at 20 ms intervals; slower playback uses the same images.</p>${gallery.join('')}`);
 await page.locator('#walk-stabilized').check();
 // Toggle corrections on a shifted drawing without advancing its phase or roots.
 await page.locator('#walk-blend').selectOption('original');await seek(643);
 const corrected=await capture();await page.locator('#walk-stabilized').uncheck();await rendered();const raw=await capture();
 assert.notDeepEqual(await sharp(corrected).raw().toBuffer(),await sharp(raw).raw().toBuffer());
 await page.locator('#walk-stabilized').check();await rendered();assert.deepEqual(await sharp(await capture()).raw().toBuffer(),await sharp(corrected).raw().toBuffer());
 for(const mode of modes)for(const state of ['stabilized','raw'])for(const [speed,duration] of [['normal',1000],['quarter',4000]] as const)for(const format of ['gif','webp']){const meta=await sharp(path.join(output,`${mode}-${state}-${speed}.${format}`),{animated:true}).metadata();assert.equal(meta.delay!.reduce((a,b)=>a+b,0),duration);}
 checks.push('28 synchronized renderer previews: seven modes, stabilization on/off, normal/quarter speed; fixed cameras, actor roots and root markers; reversible same-time offset toggle');
 }
 // Trial controls also drive real movement; no smoothing is applied to idle/action poses.
 await page.getByRole('button',{name:'Encounter',exact:true}).click();
 await page.evaluate(()=>window.foundation.sim.enemies.forEach(e=>e.stun=10000));
 for(const mode of modes){
  await page.getByRole('button',{name:'Pause / save',exact:true}).click();await page.locator('#game-walk-blend').selectOption(mode);
  assert.equal(await page.locator('#walk-blend').inputValue(),mode);await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.keyboard.down('KeyD');await page.waitForFunction(()=>window.foundation.sim.hero.state==='walk');await rendered();
  const moving=await page.evaluate(()=>{const f=window.foundation,v=f.presentation.actors.get('player')!;return{frame:v.sprite.lastFrame,mode:f.presentation.walkBlend,stabilized:v.sprite.stabilized,clip:v.sprite.animator.clip.frames.length};});
  assert.ok(moving.frame.startsWith('walk-'));assert.equal(moving.mode,mode);assert.equal(moving.clip,16);assert.equal(moving.stabilized,true);
  await page.keyboard.up('KeyD');await page.waitForFunction(()=>window.foundation.sim.hero.state==='idle');await rendered();
  assert.equal(await page.evaluate(()=>window.foundation.presentation.actors.get('player')!.sprite.lastFrame),'walk-05');
 }
 checks.push('pause-menu controls select all modes during real keyboard movement; stopping restores the still pose');
 if(!process.argv.includes('--quick')){
 // Controlled moving gameplay: the real simulation advances at 60 Hz and renders at 50 Hz.
 const gameplayTraces:unknown[]=[];
 for(const stabilized of [true,false])for(const mode of ['original','guarded-short'] as const){
  await page.evaluate(({stabilized,mode})=>{const f=window.foundation,h=f.sim.hero;f.pause(true);document.querySelector<HTMLElement>('#modal')!.hidden=true;Object.assign(h,{x:0,z:3,px:0,pz:3,state:'idle',age:0});f.sim.move(h,0,0);f.sim.enemies.forEach(e=>e.stun=10000);f.presentation.walkStabilized=stabilized;f.presentation.walkBlend=mode;f.presentation.update(f.sim,1,0,{x:0,z:1});}, {stabilized,mode});
  const frames:Buffer[]=[];let ticks=0;
  for(let i=0;i<50;i++){
   const target=1+Math.floor(i*20/(1000/60)),steps=target-ticks;ticks=target;
   const snapshot=await page.evaluate(({steps,ms})=>{
    const f=window.foundation,p=f.presentation;
    for(let tick=0;tick<steps;tick++)f.sim.step({move:{x:Math.SQRT1_2,z:-Math.SQRT1_2},aim:{x:0,z:1}});
    p.update(f.sim,1,ms,{x:0,z:1});const v=p.actors.get('player')!,h=f.sim.hero;
    const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d')!;ctx.imageSmoothingQuality='high';ctx.drawImage(p.canvas,0,0,960,540);
    return{pixels:canvas.toDataURL('image/png').split(',')[1]!,root:{frame:v.sprite.lastFrame,time:v.sprite.animator.time,sprite:v.sprite.mesh.position.toArray(),camera:p.cameraTarget.toArray(),shadow:v.shadow.position.toArray(),x:h.x,z:h.z}};
   },{steps,ms:i?20:0});
   frames.push(await sharp(Buffer.from(snapshot.pixels,'base64')).ensureAlpha().raw().toBuffer());
   const root=snapshot.root;assert.deepEqual(root.sprite,root.camera);assert.equal(root.sprite[0],root.x);assert.equal(root.sprite[2],root.z);assert.ok(Math.abs(root.shadow[1]!-root.sprite[1]!-.03)<1e-6);
   gameplayTraces.push({stabilized,mode,ticks,...root});
  }
  for(const [speed,delay] of [['normal',20],['quarter',80]] as const){
   await sharp(Buffer.concat(frames),{raw:{width:960,height:540*frames.length,channels:4,pageHeight:540}}).gif({loop:0,delay:Array(frames.length).fill(delay),effort:3,dither:0}).toFile(path.join(output,`gameplay-${mode}-${stabilized?'stabilized':'raw'}-${speed}.gif`));
   await sharp(Buffer.concat(frames),{raw:{width:960,height:540*frames.length,channels:4,pageHeight:540}}).webp({lossless:true,effort:2,loop:0,delay:Array(frames.length).fill(delay)}).toFile(path.join(output,`gameplay-${mode}-${stabilized?'stabilized':'raw'}-${speed}.webp`));
  }
 }
 await page.evaluate(()=>{window.foundation.presentation.walkStabilized=true;});
 await fs.writeFile(path.join(output,'gameplay-traces.json'),JSON.stringify(gameplayTraces,null,2)+'\n');
 checks.push('eight controlled moving gameplay previews for held/guarded-short modes with offsets on/off, normal/quarter speed; real 60 Hz physics with camera and shadow on the unchanged root');
 }
 await page.evaluate(()=>window.foundation.fixture('upper-landing'));await rendered();
 await page.evaluate(()=>{const f=window.foundation;f.pause(true);document.querySelector<HTMLElement>('#modal')!.hidden=true;Object.assign(f.sim.hero,{state:'walk'});});await rendered();
 const time=await page.evaluate(()=>window.foundation.presentation.actors.get('player')!.sprite.animator.time);await rendered();await rendered();assert.equal(await page.evaluate(()=>window.foundation.presentation.actors.get('player')!.sprite.animator.time),time);
 const lifetime=[];for(let i=0;i<5;i++){await page.evaluate(()=>window.foundation.reset());await rendered();lifetime.push(await page.evaluate(()=>window.foundation.stats().objects));}assert.deepEqual(lifetime.at(-1),lifetime[1]);
 checks.push('global pause freezes smoothing; room replacement reuses flow texture and releases sprite resources');
 // Capture a world overlap at a visible blend, including the ramp support path.
 await page.evaluate(()=>window.foundation.fixture('upper-landing'));await rendered();
 await page.evaluate(()=>{const f=window.foundation;f.pause(true);document.querySelector<HTMLElement>('#modal')!.hidden=true;Object.assign(f.sim.hero,{x:-4.7,z:-6,px:-4.7,pz:-6,state:'walk'});f.sim.move(f.sim.hero,0,0);f.presentation.walkBlend='motion';f.presentation.verticalSpan=13;f.presentation.resize();});await rendered();
 await page.evaluate(()=>window.foundation.presentation.actors.get('player')!.sprite.animator.seek(480));await rendered();
 const depth=await page.evaluate(()=>{const s=window.foundation.presentation.actors.get('player')!.sprite;return{coreTest:s.material.depthTest,coreWrite:s.material.depthWrite,edgeTest:s.edgeMaterial!.depthTest,edgeWrite:s.edgeMaterial!.depthWrite};});
 assert.deepEqual(depth,{coreTest:true,coreWrite:true,edgeTest:true,edgeWrite:false});
 await page.screenshot({path:path.join(output,'motion-pillar-behind.png'),scale:'device'});
 await page.evaluate(()=>window.foundation.fixture('upper-landing'));await rendered();
 await page.evaluate(()=>{const f=window.foundation;f.pause(true);document.querySelector<HTMLElement>('#modal')!.hidden=true;const h=f.sim.hero;Object.assign(h,{x:0,z:3.75,px:0,pz:3.75,state:'walk'});f.sim.move(h,0,0);f.presentation.walkBlend='motion';f.presentation.actors.get('player')?.sprite.animator.seek(480);});await rendered();
 await page.evaluate(()=>window.foundation.presentation.actors.get('player')!.sprite.animator.seek(480));await rendered();
 const support=await page.evaluate(()=>{const f=window.foundation,v=f.presentation.actors.get('player')!;return{hero:f.sim.hero.y,sprite:v.sprite.mesh.position.y,shadow:v.shadow.position.y};});assert.ok(support.hero>0,'raised-floor fixture required');assert.equal(support.sprite,support.hero);assert.ok(Math.abs(support.shadow-support.hero-.03)<1e-6);
 await page.screenshot({path:path.join(output,'motion-ramp.png'),scale:'device'});
 assert.deepEqual(errors,[]);checks.push('motion blend keeps pillar occlusion, registered ground/ramp roots and cutout passes; no renderer errors');
 // Trial controls also exist in isolated Dev Game Preview, while its inspection API stays absent.
 await page.getByRole('button',{name:'Play Opening Scene',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('canvas')?.getAttribute('data-ready')==='true'&&!('foundation' in window));
 await page.getByRole('button',{name:'Pause / save',exact:true}).click();
 assert.equal(await page.locator('#game-walk-blend option').count(),modes.length);assert.equal(await page.locator('#game-walk-blend').inputValue(),'original');assert.equal(await page.locator('#game-walk-stabilized').isChecked(),true);
 for(const mode of modes){await page.locator('#game-walk-blend').selectOption(mode);assert.equal(await page.locator('#walk-blend-help').textContent(),walkBlendModes[mode].description);}
 await page.locator('#game-walk-stabilized').uncheck();await page.locator('#game-walk-stabilized').check();await page.locator('#game-walk-blend').selectOption('original');
 await page.getByRole('button',{name:'Save checkpoint',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Checkpoint saved');
 const save=JSON.parse(await fs.readFile(path.join(profile,'preview/saves/game.json'),'utf8'));assert.equal('walkBlend' in save,false);assert.equal('walkStabilized' in save,false);
 await page.screenshot({path:path.join(output,'dev-preview-controls.png'),scale:'device'});
 await page.getByRole('button',{name:'Return to Sandbox',exact:true}).click();await page.waitForFunction(()=>window.foundation?.ready);
 assert.equal(await page.evaluate(()=>window.foundation.presentation.walkBlend),'original');assert.equal(await page.evaluate(()=>window.foundation.presentation.walkStabilized),true);
 checks.push('Dev Game Preview exposes all seven presets and offset toggle without inspection API; choices stay outside saves and fresh sessions restore stabilized Original');
 const stats=await page.evaluate(()=>window.foundation.stats());
 await fs.writeFile(path.join(output,'walk-blend-smoke.json'),JSON.stringify({checks,errors,samples,support,stats,packageSha256,limitations:['Hidden-window runtime; visible pacing and Windows unverified.','Motion correspondence is approximate and can bend equipment.','Lab previews enlarge artwork for comparison; gameplay quality gate remains spans 11–15.']},null,2)+'\n');
 console.log(`PASS: ${checks.length} packaged walk-blending checks; previews in ${output}`);
}catch(error){await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error),errors,checks}));throw error;}finally{await launch.close();}
