import {readAsset} from '../tools/assets/io';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as T from 'three';
import {graveyardScene} from '../src/content/graveyard-scene';
import {sceneArtFindings} from '../src/content/scene-art-validation';
import {content,isSupportedPosition,supportedPosition} from '../src/content/world';
import {areaArtAssets} from '../src/content/world-art';
import {assetCatalog} from '../src/content/visuals';
import {parseManifest} from '../src/assets/schema';
import {InkRoom} from '../src/presentation/ink-room';
import {makeCamera} from '../src/core/camera';
import {Simulation} from '../src/core/simulation';
import {cardCoverage,coverageAt} from '../src/presentation/scenery-reveal';
import {pageIdentity} from '../src/assets/loader';
import {coplanarMeshConflicts} from '../src/presentation/mesh-plane-validation';
import {coplanarArtConflicts} from '../src/presentation/carrier-validation';
import {ActorSprite} from '../src/presentation/sprite';
import type {PackLease} from '../src/assets/loader';
import {readRegistration} from '../tools/assets/data';
const coverage=readRegistration().coverage;
async function fixture(){const packs=new Map<string,PackLease>();for(const id of areaArtAssets(content.area('court'))){const manifest=parseManifest(JSON.parse(await readAsset('public/'+assetCatalog[id]!,'utf8')));packs.set(id,{manifest,textures:new Map(manifest.pages.map(p=>[p.id,new T.Texture()]))} as PackLease);}const room=new InkRoom(content.area('court'),packs,new T.Group(),makeCamera(16/9),undefined,readRegistration());room.build();return {room,packs,dispose(){room.dispose();for(const p of packs.values())for(const t of p.textures.values())t.dispose();}};}

test('art validation rejects solid penetration and an allowance reused away from its registered join',()=>{
 assert.deepEqual(sceneArtFindings(graveyardScene),[]);const moved={...graveyardScene,props:graveyardScene.props.map(p=>p.id==='gate-lamp'?{...p,x:-6.1,z:1.4}:p)};assert.ok(sceneArtFindings(moved).some(f=>f.kind==='solid-intersection'&&[f.a,f.b].includes('family-tomb-west')));
 const invalid={...graveyardScene,overlaps:[{a:'gate-lamp',b:'family-tomb-west',region:{minX:-3.7,maxX:-3.05,minZ:7.9,maxZ:8.5},reason:'Registered original join'}],props:moved.props};assert.ok(sceneArtFindings(invalid).some(f=>f.kind==='solid-intersection'));
});
test('oriented footprint collision follows the visible long axis rather than its axis-aligned bounding box',()=>{
 const base=content.area('court'),area={...base,props:[{id:'angled-tomb',kind:'wall' as const,x:0,z:0,radius:.2,height:1,size:[2,.4] as const,shape:'box' as const,rotation:Math.PI/4}]};
 assert.ok(!isSupportedPosition(area,{x:.55,z:.55},.3));assert.ok(isSupportedPosition(area,{x:.8,z:-.8},.3));const q=supportedPosition(area,{x:0,z:0},.3);assert.ok(isSupportedPosition(area,q,.3));assert.ok(Math.abs(q.x+q.z)<1e-8);
});
test('four-centimetre reversals behind a near tree retains one shader/depth policy and a continuous local reveal',async()=>{
 const f=await fixture(),sim=new Simulation();sim.enemies.forEach(a=>a.health=0);try{
  const tree=graveyardScene.props.find(p=>p.id==='foreground-oak')!;Object.assign(sim.hero,{x:tree.x,z:tree.z-.2,px:tree.x,pz:tree.z-.2});for(let i=0;i<30;i++)f.room.update(sim,1,false,1000/60);
  const wall=f.room.sprites.filter(s=>s.id==='foreground-oak'),versions=wall.map(s=>s.material.version);const before=f.room.graveyard!.revealStats();
  for(const z of [tree.z-.16,tree.z-.2,tree.z-.16,tree.z-.2]){Object.assign(sim.hero,{z,pz:z});f.room.update(sim,1,false,1000/60);assert.ok(wall.every(s=>s.material.opacity===1&&s.material.transparent&&s.material.depthWrite));assert.deepEqual(wall.map(s=>s.material.version),versions);}
  const after=f.room.graveyard!.revealStats();assert.ok(after.some(s=>s.strength>.5));assert.ok(after.every((s,i)=>Math.abs(s.strength-before[i]!.strength)<.3),'tiny reversals must not jump a whole module between solid and invisible');
  const paused=after.map(s=>s.strength);f.room.update(sim,1,false,0);assert.deepEqual(f.room.graveyard!.revealStats().map(s=>s.strength),paused);
 }finally{f.dispose();}
});
test('source alpha testing precedes reveal opacity for both core and soft edges',async()=>{
 const f=await fixture();try{const wall=f.room.fades.find(s=>s.id==='foreground-oak')!;
 for(const m of [wall.material,wall.edgeMaterial!]){const shader={uniforms:{},vertexShader:'#include <project_vertex>',fragmentShader:'#include <alphatest_fragment>\n#include <opaque_fragment>'} as unknown as T.WebGLProgramParametersWithUniforms;m.onBeforeCompile(shader,{} as T.WebGLRenderer);assert.ok(shader.fragmentShader.indexOf('#include <alphatest_fragment>')<shader.fragmentShader.indexOf('diffuseColor.a*=1.-reveal'));if(m===wall.edgeMaterial)assert.ok(shader.fragmentShader.indexOf('discard;')<shader.fragmentShader.indexOf('diffuseColor.a*=1.-reveal'));}
 assert.equal(wall.edgeMaterial!.depthWrite,false);assert.equal(wall.material.depthWrite,true);
 }finally{f.dispose();}
});
test('alpha-aware validation distinguishes a real duplicated card from empty carrier overlap',async()=>{
 assert.equal(coverageAt({width:2,height:1,alpha:[255,0]},.75,.5),0);const f=await fixture();try{const stone=f.room.sprites.find(s=>s.id==='grave-family-kept')!,copy=new ActorSprite('accidental-copy',stone.manifest,stone.textures,stone.animator.clip);copy.show(copy.animator.frame,stone.mesh.position.clone(),makeCamera(16/9));copy.mesh.scale.copy(stone.mesh.scale);assert.ok(coplanarArtConflicts([stone,copy],coverage.masks).length===1);const p=new T.Vector3(100,100,100);assert.equal(cardCoverage(stone,p),0);copy.dispose();}finally{f.dispose();}
});
test('terrain mips never share identity with a non-mipmapped lease or bleed across atlas frames',async()=>{
 const m=parseManifest(JSON.parse(await readAsset('public/'+assetCatalog['ink-graveyard-materials']!,'utf8')));assert.ok(m.pages.every(p=>p.mipmaps));assert.notEqual(pageIdentity(m.pages[0]!),pageIdentity({...m.pages[0]!,mipmaps:false}));const bad=structuredClone(m);bad.frames[0]!.rect[0]=1;assert.throws(()=>parseManifest(bad));
});

test('opaque masonry validation rejects the porch/foundation depth tie while permitting their butt join',async()=>{
 const f=await fixture();try{const parts=f.room.graveyard!.architecture.parts;assert.deepEqual(coplanarMeshConflicts(parts),[]);const landing=parts.find(p=>p.userData.id==='porch-landing')!,foundation=parts.find(p=>p.userData.id==='chapel-foundation')!;landing.position.z-=.3;assert.ok(coplanarMeshConflicts([landing,foundation]).length>0,'overlapping supported tops must fail the construction gate');}finally{f.dispose();}
});

test('blocked terrain volumes reject buried roots and bodies exactly on a polygon edge',()=>{
 const area={...content.area('court'),props:[{id:'terrain',kind:'border' as const,x:0,z:0,radius:.2,height:.7,shape:'polygon' as const,polygon:[{x:0,z:0},{x:2,z:0},{x:2,z:2},{x:0,z:2}]}]};
 for(const p of [{x:1,z:1},{x:2,z:1}]){assert.equal(isSupportedPosition(area,p,.3),false);const q=supportedPosition(area,p,.3);assert.equal(isSupportedPosition(area,q,.3),true);assert.ok(q.x>=2.3||q.x<=-.3||q.z>=2.3||q.z<=-.3);}
});
