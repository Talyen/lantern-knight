import {assetFile} from '../tools/assets/paths';
import {readAsset} from '../tools/assets/io';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import * as T from 'three';
import {ActorSprite} from '../src/presentation/sprite';
import {OcclusionFades} from '../src/presentation/occlusion-fades';
import {findDepthConflicts,validateConstruction} from '../src/presentation/art-validation';
import {content,isSupportedPosition} from '../src/content/world';
import {worldVisuals,compositionPoint} from '../src/content/world-art';
import {assetCatalog} from '../src/content/visuals';
import {parseManifest,resolveClip} from '../src/assets/schema';
import {makeCamera} from '../src/core/camera';
import {Simulation} from '../src/core/simulation';
import {GameSession} from '../src/core/session';
import {parseGame} from '../src/core/save';
import {inspectCrypt} from '../tools/check-crypt-art';

test('Crypt construction has registered mounts, clear entry/combat routes and no opaque depth ties',async()=>{
 const result=await inspectCrypt();assert.deepEqual(result.constructionErrors,[]);assert.deepEqual(result.depthConflicts,[]);assert.ok(result.checkedParts>50);
 const art=worldVisuals['upper-landing']!;assert.deepEqual(validateConstruction(content.area('upper-landing'),{...art,props:art.props.map(p=>p.mount?{...p,y:99}:p)}).filter(e=>e.includes('mount')).length,art.props.filter(p=>p.mount).length);
 assert.ok(!art.props.some(p=>p.clip==='arch'),'the door already includes its surround');
});
test('alpha-aware depth gate rejects the original door/arch conflict but ignores transparent margins and separated planes',async()=>{
 const m=parseManifest(JSON.parse(await readAsset(`public/${assetCatalog['ink-scenery']}`,'utf8'))),textures=new Map(m.pages.map(p=>[p.id,new T.Texture()])),camera=makeCamera(16/9);
 const arch=new ActorSprite('arch',m,textures,resolveClip(m,'arch','d45')),door=new ActorSprite('door',m,textures,resolveClip(m,'door-closed','d45'));
 try{
  arch.show(arch.animator.frame,new T.Vector3(),camera);door.show(door.animator.frame,new T.Vector3(),camera);
  const images=new Map<T.Mesh,{width:number;height:number;data:Uint8Array}>();
  for(const [sprite,file]of [[arch,'arch'],[door,'door-closed']] as const){const frame=sprite.frameIndex.get(sprite.lastFrame)!,page=m.pages.find(p=>p.id===frame.page)!,raw=await sharp(assetFile(`public/generated/ink/ink-scenery/${page.path}`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});images.set(sprite.mesh,{width:raw.info.width,height:raw.info.height,data:raw.data});sprite.mesh.userData.artPart={id:file};}
  assert.equal(findDepthConflicts([arch.mesh,door.mesh],images).length,1);
  door.mesh.position.x=.05;assert.deepEqual(findDepthConflicts([arch.mesh,door.mesh],images),[]);
  door.mesh.position.set(0,0,0);for(const im of images.values())im.data.fill(0);assert.deepEqual(findDepthConflicts([arch.mesh,door.mesh],images),[]);
 }finally{arch.dispose();door.dispose();for(const t of textures.values())t.dispose();}
});
test('assembly fades ease, use interpolated fighters, freeze on pause, and restore more slowly',()=>{
 const sim=new Simulation(142,'upper-landing');for(const a of sim.enemies)a.health=0;Object.assign(sim.hero,{x:0,z:0,px:0,pz:0});
 const f=new OcclusionFades(),camera=makeCamera(16/9),meshes=[0,1].map(()=>{const m=new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshBasicMaterial());m.position.y=.3;m.quaternion.copy(camera.quaternion);f.add(m,'bay');return m;});
 try{f.update(sim,1,1000/60);const initial=meshes[0]!.material.opacity;assert.ok(initial<1&&initial>.8);assert.equal(initial,meshes[1]!.material.opacity);
  f.update(sim,1,150);assert.equal(meshes[0]!.material.opacity,.18);assert.equal(meshes[0]!.material.depthWrite,false);
  sim.hero.health=0;f.update(sim,1,100);assert.equal(meshes[0]!.material.opacity,.18,'the held death pose remains visible');
  Object.assign(sim.hero,{x:50,z:50,px:0,pz:0});f.update(sim,0,16);assert.equal(meshes[0]!.material.opacity,.18,'interpolated old position still obscures');
  f.update(sim,1,0);assert.equal(meshes[0]!.material.opacity,.18,'pause freezes opacity');f.update(sim,1,100);assert.ok(meshes[0]!.material.opacity>.18&&meshes[0]!.material.opacity<1);
  f.update(sim,1,250);assert.equal(meshes[0]!.material.opacity,1);assert.equal(meshes[0]!.material.depthWrite,true);
 }finally{for(const m of meshes){m.geometry.dispose();m.material.dispose();}}
});
test('new bay dressing reconciles v5 roots without losing vital state, enemy health or progress',()=>{
 const save=new GameSession(content,142,'upper-landing').captureSave();Object.assign(save.player,{x:-6.85,z:-5.15,health:63,cooldown:17,dodgeCooldown:8});Object.assign(save.areas['upper-landing']!.actors['warden-1']!,{x:6.15,z:-5.45,health:17});save.areas['upper-landing']!.engaged=true;
 const original=JSON.stringify(save),result=parseGame(save);assert.equal(JSON.stringify(save),original);assert.equal(result.version,5);assert.equal(result.player.health,63);assert.equal(result.player.cooldown,17);assert.equal(result.player.dodgeCooldown,8);assert.ok(isSupportedPosition(content.area('upper-landing'),result.player,.3));
 assert.equal(result.areas['upper-landing']!.actors['warden-1']!.health,17);assert.equal(result.areas['upper-landing']!.engaged,true);assert.equal(result.areas['upper-landing']!.cleared,false);
});
test('arrival framing reveals the sanctuary while remaining continuous at the handoff to normal follow',()=>{
 assert.equal(compositionPoint('upper-landing',{x:0,z:7.5}).z,2);
 const before=compositionPoint('upper-landing',{x:0,z:3.00001}),after=compositionPoint('upper-landing',{x:0,z:2.99999});assert.ok(Math.abs(before.z-after.z)<.0001);
});
