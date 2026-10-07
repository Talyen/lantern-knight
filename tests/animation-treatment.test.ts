import {hash} from '../tools/compiler';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Texture,Vector3,MeshBasicMaterial} from 'three';
import {readAsset} from '../tools/assets/io';
import {readRegistration} from '../tools/assets/data';
import {parseRegistration} from '../src/assets/registration';
import {parseManifest,resolveClip} from '../src/assets/schema';
import {sampleAnimation} from '../src/core/animation-treatment';
import {timedWalk,remapWalkTime} from '../src/core/locomotion-timing';
import {AnimationBlendShader,registeredTrim} from '../src/presentation/animation-blend-shader';
import {ActorSprite} from '../src/presentation/sprite';
import {makeCamera,trimmedBounds} from '../src/core/camera';
import {heroTimings} from '../src/content/hero-actions';
import {defaultLook} from '../src/presentation/lighting-profiles';
const m=parseManifest(JSON.parse(await readAsset('public/generated/ink/ink-hero-current/manifest.json','utf8'))),registration=readRegistration();
test('current transition inventory binds all clips/directions and preserves action holds',()=>{
 const frames=new Set(m.frames.map(f=>f.id));
 for(const [name,dirs]of Object.entries(m.asset.clips))for(const [heading,c]of Object.entries(dirs)){
  const data=registration.animation.clips[`${name}:${heading}`]!;assert.ok(data);assert.deepEqual(data.frames,c!.frames);
  assert.deepEqual(c!.durationsMs,heroTimings[name]![heading as keyof typeof heroTimings[string]].holdsMs);
  if(name==='walk'){const weighted=timedWalk(c!,'weighted',data.weightedHoldsMs);assert.ok(Math.abs(weighted.durationsMs.reduce((a,b)=>a+b)-c!.durationsMs.reduce((a,b)=>a+b))<.001);const time=c!.durationsMs[0]!*.3;assert.ok(Math.abs(remapWalkTime(c!,weighted,time)-weighted.durationsMs[0]!*.3)<.001);}
  else assert.deepEqual(data.weightedHoldsMs,c!.durationsMs);
 }
 for(const p of registration.animation.pairs){assert.ok(frames.has(p.from)&&frames.has(p.to));assert.equal(p.asset,m.asset.id);if(p.supported){assert.ok(p.sword);assert.ok(p.silhouetteAgreement>=.96);assert.ok(p.colorError<=.09);assert.equal(p.rejectionReason,null);}}
});
test('mixed-density guarded sampling keeps the foot fixed and restores native held geometry',()=>{
 const textures=new Map(m.pages.map(p=>[p.id,new Texture()])),flow={...registration.animation,texture:new Texture()},camera=makeCamera(16/9),foot=new Vector3(1,.2,2);
 const clip=resolveClip(m,'sweep','d00'),sprite=new ActorSprite('mixed',m,textures,clip),material=new MeshBasicMaterial(),shader=new AnimationBlendShader([material]);
 const a=m.frames.find(f=>f.id===clip.frames[0])!,b=m.frames.find(f=>f.id===clip.frames[1])!,pair=flow.pairs.find(p=>p.from===a.id&&p.to===b.id)!;
 assert.notEqual(a.registration!.density,b.registration!.density);
 const sample={from:a.id,to:b.id,mix:.4,motion:true,guarded:true};shader.update(sample,m,a,b,textures,flow);
 for(const [f,u]of [[a,shader.uniforms.walkTrimA],[b,shader.uniforms.walkTrimB]] as const){const t=registeredTrim(m,{...f,visualOffsetPx:flow.offsets[f.id]},pair);assert.equal(u.value.x,t[0]/pair.canvas[0]);assert.equal(u.value.z,t[2]/pair.canvas[0]);}
 sprite.animator.seek(clip.durationsMs[0]!*.4);sprite.showAnimation(foot,camera,'guarded',flow);assert.deepEqual(sprite.mesh.position,foot);
 sprite.stabilized=false;sprite.showAnimation(foot,camera,'original',flow);const bounds=trimmedBounds(a.registration!,a.trim),p=sprite.geometry.getAttribute('position');assert.ok(Math.abs(p.getX(0)-bounds.left)<1e-6);assert.ok(Math.abs(p.getY(0)-bounds.top)<1e-6);
 const unsupported={...flow,pairs:flow.pairs.map(p=>({...p,supported:false}))};sprite.showAnimation(foot,camera,'guarded',unsupported);assert.equal(sprite.lightingSample!.blend,undefined);
 sprite.dispose();material.dispose();flow.texture.dispose();textures.forEach(t=>t.dispose());
});
test('guarded sampling respects variable holds, looping and terminal death poses',()=>{
 const c={frames:['a','b','c'],durationsMs:[100,50,150],loop:true,notifies:[]};
 assert.equal(sampleAnimation(c,50,'guarded').mix,.5);assert.equal(sampleAnimation(c,100.01,'guarded').from,'b');assert.equal(sampleAnimation(c,299.99,'guarded').to,'a');
 const terminal=sampleAnimation({...c,loop:false},9999,'guarded');assert.equal(terminal.from,'c');assert.equal(terminal.to,'c');
});
test('registration rejects duplicate pairs, escaped crops and degenerate sword lines',()=>{
 const value=structuredClone(registration);value.animation.pairs.push(value.animation.pairs[0]!);assert.throws(()=>parseRegistration(value),/Duplicate/);
 const crop=structuredClone(registration);crop.animation.pairs[0]!.rect[0]=crop.animation.width;assert.throws(()=>parseRegistration(crop),/escapes/);
 const blade=structuredClone(registration);Object.assign(blade.animation.pairs[0]!,{supported:true,silhouetteAgreement:1,colorError:0,rejectionReason:null,sword:{a:[1,1,1,1],b:[2,2,3,3],width:8}});assert.throws(()=>parseRegistration(blade),/Degenerate/);
});
test('shared authoring/player look starts Golden/Diorama at 150%',()=>{assert.equal(defaultLook.rig,'golden');assert.equal(defaultLook.look,'diorama');assert.equal(defaultLook.strength,1.5);});

test('canonical artwork remains byte-identical',async()=>{assert.equal(hash(await readAsset('references/canon/image(3).png')),'74ba2c2004e5b30da8c35f192fd725957a2a24f8b26de0ad58163608cb7dd09c');});
