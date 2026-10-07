import {readRegistration} from '../tools/assets/data';
import {assetFile} from '../tools/assets/paths';
import {readAsset} from '../tools/assets/io';
import {sandboxContent} from '../src/content/sandbox-world';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import {execFileSync} from 'node:child_process';
import {Texture,Vector3,BufferAttribute,MeshBasicMaterial} from 'three';
import {parseSource,parseManifest,resolveClip} from '../src/assets/schema';
import {ActorSprite,setCutoutOpacity} from '../src/presentation/sprite';
import {makeCamera,HEADINGS,trimmedBounds,drawingBufferSize} from '../src/core/camera';
import {frameAt,clipDuration} from '../src/core/animation';
import {timedWalk,walkTimings,remapWalkTime} from '../src/core/walk-timing';
import {correctWalkArm,armDisplacement} from '../tools/walk-arm-correction';
import {registeredSword} from '../src/presentation/rigid-sword';
import {WalkBlendShader} from '../src/presentation/walk-blend-shader';
import {sampleWalkBlend,walkBlendModes} from '../src/core/walk-blending';
import {actorVisuals} from '../src/content/visuals';
import {areaArtAssets,validateAreaArt,floorUV} from '../src/content/world-art';
import {content} from '../src/content/world';
import {hash} from '../tools/compiler';
async function manifest(id:string){return parseManifest(JSON.parse(await readAsset(`public/generated/ink/${id}/manifest.json`,'utf8')));}
function sourceFromManifest(m:ReturnType<typeof parseManifest>){return {schemaVersion:2,asset:structuredClone(m.asset),frames:m.frames.map(f=>({id:f.id,path:f.source,origin:f.origin,attachments:f.attachments,...(f.visualOffsetPx?{visualOffsetPx:f.visualOffsetPx}:{})}))};}

test('canonical source bytes, fixed-view actor selection and production gate remain explicit',async()=>{
 assert.equal(hash(await readAsset('references/canon/image(3).png')),'74ba2c2004e5b30da8c35f192fd725957a2a24f8b26de0ad58163608cb7dd09c');
 for(const id of ['ink-hero','ink-revenant']){const m=await manifest(id),view=Object.values(actorVisuals).find(v=>v.asset===id)!;
  assert.deepEqual(Object.keys(m.asset.clips.rest!),['d45']);
  for(const heading of HEADINGS)for(const name of [...Object.values(view.clips),...view.attacks])assert.equal(resolveClip(m,name,heading),m.asset.clips[name]!.d45);
  assert.throws(()=>parseManifest(m,true),/development-only|production/);
 }
 const directional=JSON.parse(await readAsset('tests/fixtures/valid.json','utf8'));delete directional.asset.clips.walk.d00;
 assert.throws(()=>parseSource(directional),/missing required heading/);
});

test('padded Revenant registration shifts with the original canvas rather than atlas trim',async()=>{
 const d=JSON.parse(await readAsset('staging/ink/derivatives.json','utf8')).frames.find((f:{pack:string})=>f.pack==='ink-revenant');
 const m=await manifest('ink-revenant'),f=m.frames[0]!,bounds=trimmedBounds(m.asset,f.trim);
 assert.deepEqual(d.sourceCanvas,[1374,1267]);assert.deepEqual(d.sourceAnchor,[687,1169]);assert.deepEqual(d.derivativeAnchor,m.asset.anchor);
 assert.equal(m.asset.anchor[0],687*612/1374);assert.equal(m.asset.anchor[1],1169*564/1267);
 assert.ok(Math.abs(bounds.left+(m.asset.anchor[0]-f.trim[0])/m.asset.density)<1e-12);
});

test('projected effects retain transparent time records and all eight authored headings',async()=>{
 const m=await manifest('ink-combat');assert.equal(m.asset.allowEmptyFrames,true);
 for(const headings of Object.values(m.asset.clips))for(const heading of HEADINGS){const c=headings[heading]!;
  assert.equal(c.frames.length,c.durationsMs.length);assert.ok(clipDuration(c)>0);assert.equal(frameAt(c,0),c.frames[0]);assert.equal(frameAt(c,clipDuration(c)),c.frames.at(-1));
 }
 const source=sourceFromManifest(await manifest('ink-hero'));source.asset.allowEmptyFrames=true;
 assert.throws(()=>parseSource(source),/only effects/);
});

test('raw floor and wall artwork project once, and effects do not write depth',async()=>{
 const camera=makeCamera(16/9),foot=new Vector3(0,0,0);
 for(const [id,projection] of [['ink-decals','top-down'],['ink-wall-face','front-view'],['ink-combat','projected-world']] as const){
  const m=await manifest(id),clip=resolveClip(m,Object.keys(m.asset.clips)[0]!,'d45'),textures=new Map(m.pages.map(p=>[p.id,new Texture()]));
  const sprite=new ActorSprite(id,m,textures,clip);sprite.show(clip.frames.find(f=>m.frames.find(v=>v.id===f)!.trim[2]>2)??clip.frames[0]!,foot,camera);
  const p=sprite.geometry.getAttribute('position') as BufferAttribute;
  for(let i=0;i<p.count;i++){const corner=new Vector3().fromBufferAttribute(p,i).applyMatrix4(sprite.mesh.matrix.compose(sprite.mesh.position,sprite.mesh.quaternion,sprite.mesh.scale));
   if(projection==='top-down')assert.ok(Math.abs(corner.y)<1e-12);
   if(projection==='front-view')assert.ok(Math.abs(corner.z)<1e-12);
   const projected=corner.clone().project(camera).toArray();assert.ok(projected.every(Number.isFinite));
  }
  if(projection==='projected-world')assert.equal(sprite.material.depthWrite,false);
  sprite.dispose();
 }
 assert.ok(areaArtAssets(content.area('court')).includes('ink-scenery'));
 assert.deepEqual(areaArtAssets(sandboxContent.area('systems-fixture')),[]);
});

test('collection importer checks hashes, identical duplicates, unsafe paths and conflicts before writing',()=>{
 const script=`import sys,importlib.util,tempfile,pathlib,json,zipfile,hashlib
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('importer','tools/import-ink.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp).resolve();m.DEST=p/'out'
 def setup(names):
  archives=[]
  for i,members in enumerate(names):
   name=f'pack{i}.zip'
   with zipfile.ZipFile(p/name,'w') as z:
    for key,data in members.items():z.writestr(key,data)
   data=(p/name).read_bytes();archives.append({'file_name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  with zipfile.ZipFile(p/'Lantern_Revision02_Quality_Notes.zip','w'):pass
  (p/'Lantern_Revision02_Asset_Index.json').write_text(json.dumps({'frozen':True,'archives':archives}))
 setup([{'art/test.txt':b'same'},{'art/test.txt':b'same'}]);_,_,entries=m.collect(p);assert len(entries['art/test.txt']['archives'])==2;assert not m.DEST.exists()
 for members in [[{'../escape':b'bad'}],[{'art/test.txt':b'a'},{'art/test.txt':b'b'}],[{'art/Test.txt':b'a'},{'art/test.txt':b'a'}]]:
  setup(members)
  try:m.collect(p)
  except ValueError:pass
  else:raise AssertionError('unsafe archive accepted')
  assert not m.DEST.exists()
 setup([{'art/test.txt':b'valid'}]);(p/'pack0.zip').write_bytes(b'changed')
 try:m.collect(p)
 except ValueError:pass
 else:raise AssertionError('hash mismatch accepted')
 assert not m.DEST.exists()
`;
 execFileSync('python3',['-c',script],{stdio:'pipe'});
});

test('room visuals validate their dependencies and clips before a transition commits',async()=>{
 const area=content.area('court'),packs=new Map(await Promise.all(areaArtAssets(area).map(async id=>[id,{manifest:await manifest(id)}] as const)));
 validateAreaArt(area,packs);packs.delete('ink-combat');assert.throws(()=>validateAreaArt(area,packs),/missing room art/);
 packs.set('ink-combat',{manifest:await manifest('ink-combat')});delete packs.get('ink-scenery')!.manifest.asset.clips.gravestone;assert.throws(()=>validateAreaArt(area,packs),/required clip unavailable/);
});

test('cutout fades invalidate the opaque shader on transitions, without recompiling unchanged opacity',()=>{
 const m=new MeshBasicMaterial(),version=m.version;setCutoutOpacity(m,.38);assert.equal(m.transparent,true);assert.equal(m.depthWrite,false);assert.equal(m.version,version+1);
 setCutoutOpacity(m,.38);assert.equal(m.version,version+1);setCutoutOpacity(m,1);assert.equal(m.transparent,false);assert.equal(m.depthWrite,true);assert.equal(m.version,version+2);
 m.dispose();
});

test('real cutouts retain a blended edge layer with shared geometry/texture and coherent fade opacity',async()=>{
 const m=await manifest('ink-hero'),textures=new Map(m.pages.map(p=>[p.id,new Texture()]));const s=new ActorSprite('soft-hero',m,textures,resolveClip(m,'rest','d45'));
 s.show('walk-05',new Vector3(),makeCamera(16/9));assert.ok(s.edgeMesh);assert.equal(s.edgeMesh.geometry,s.geometry);assert.equal(s.edgeMaterial!.map,s.material.map);
 assert.equal(s.edgeMaterial!.depthTest,true);assert.equal(s.edgeMaterial!.depthWrite,false);assert.equal(s.edgeMaterial!.transparent,true);
 setCutoutOpacity(s.material,.38);assert.equal(s.edgeMaterial!.opacity,.38);setCutoutOpacity(s.material,1);assert.equal(s.edgeMaterial!.opacity,1);s.dispose();
});

test('top-down floor image-right maps +X and image-down maps +Z with 4-metre stone repeats',()=>{
 assert.deepEqual(floorUV(2,2),[.5,-.5]);assert.deepEqual(floorUV(4,4),[1,-1]);
});

test('Retina windows render physical pixels within the selected 4K budget, with explicit quality scaling',()=>{
 assert.deepEqual(drawingBufferSize(1280,640,2),{width:2560,height:1280,pixelRatio:2});
 assert.deepEqual(drawingBufferSize(2560,1440,2),{width:3840,height:2160,pixelRatio:1.5});
 assert.deepEqual(drawingBufferSize(1280,640,1),{width:1280,height:640,pixelRatio:1});
 assert.deepEqual(drawingBufferSize(3840,2160,1),{width:3840,height:2160,pixelRatio:1});
 assert.deepEqual(drawingBufferSize(1920,1080,2),{width:3840,height:2160,pixelRatio:2});
 assert.deepEqual(drawingBufferSize(3840,2160,2),{width:3840,height:2160,pixelRatio:1});
 assert.deepEqual(drawingBufferSize(2560,1440,2,.5),{width:1920,height:1080,pixelRatio:1.5});
 assert.deepEqual(drawingBufferSize(1280,640,2,.5),{width:1280,height:640,pixelRatio:2});
 assert.throws(()=>drawingBufferSize(0,640,2));assert.throws(()=>drawingBufferSize(1280,640,NaN));
});


test('hero walk preserves its registered root, drawings, holds and still action pose',async()=>{
 const m=await manifest('ink-hero'),tuning=JSON.parse(await readAsset('authoring/walk-tuning.json','utf8')),clip=resolveClip(m,'walk','d135');
 assert.deepEqual(m.asset.canvas,[512,640]);assert.deepEqual(m.asset.anchor,[256,572]);assert.equal(clip.frames.length,16);assert.equal(clip.loop,true);assert.deepEqual(clip.notifies,[]);assert.ok(Math.abs(clipDuration(clip)-1000)<1e-10);
 let elapsed=0;for(const [i,id]of clip.frames.entries()){assert.equal(id,`walk-${String(i+1).padStart(2,'0')}`);assert.equal(frameAt(clip,elapsed+.001),id);assert.deepEqual(m.frames.find(f=>f.id===id)!.visualOffsetPx,tuning.frames[i].visualOffsetPx);elapsed+=clip.durationsMs[i]!;}
 assert.equal(frameAt(clip,1000.001),'walk-01');for(const state of ['idle','dodge','ability','hurt','death'] as const)assert.deepEqual(resolveClip(m,actorVisuals.hero!.clips[state],'d00').frames,['walk-05']);for(const name of actorVisuals.hero!.attacks)assert.deepEqual(resolveClip(m,name,'d315').frames,['walk-05']);
});

test('visual offsets translate artwork with correct signs while keeping roots and UVs fixed',async()=>{
 const m=await manifest('ink-hero'),textures=new Map(m.pages.map(p=>[p.id,new Texture()])),camera=makeCamera(16/9),foot=new Vector3(1,.225,-2);
 const s=new ActorSprite('offset-test',m,textures,resolveClip(m,'walk','d45'));
 for(const id of ['walk-06','walk-14']){
  s.stabilized=false;s.show(id,foot,camera);
  const before=Array.from(s.geometry.getAttribute('position').array),uvs=Array.from(s.geometry.getAttribute('uv').array),[x,y]=s.frameIndex.get(id)!.visualOffsetPx!;
  s.stabilized=true;s.show(id,foot,camera);const after=s.geometry.getAttribute('position');
  for(let i=0;i<4;i++){
   assert.ok(Math.abs(after.getX(i)-before[i*3]!-x/m.asset.density)<1e-6);
   assert.ok(Math.abs(after.getY(i)-before[i*3+1]!+y/m.asset.density)<1e-6);
  }
  assert.deepEqual(s.mesh.position.toArray(),foot.toArray());assert.deepEqual(Array.from(s.geometry.getAttribute('uv').array),uvs);
  s.stabilized=false;s.show(id,foot,camera);assert.deepEqual(Array.from(after.array),before);
 }
 const f=s.frameIndex.get('walk-01')!;delete f.visualOffsetPx;
 s.show(f.id,foot,camera);const before=Array.from(s.geometry.getAttribute('position').array);s.stabilized=true;s.show(f.id,foot,camera);assert.deepEqual(Array.from(s.geometry.getAttribute('position').array),before);
 s.dispose();
});

test('blends independently register both drawings and select matching raw or guarded fields',async()=>{
 const m=await manifest('ink-hero'),data=readRegistration().walk,textures=new Map(m.pages.map(p=>[p.id,new Texture()]));
 const material=new MeshBasicMaterial(),shader=new WalkBlendShader([material]),flow={...data,texture:new Texture()},a=m.frames[13]!,b=m.frames[14]!;
 for(const stabilized of [true,false])for(const guarded of [true,false]){
  shader.update({from:a.id,to:b.id,mix:.5,motion:true,guarded},m,a,b,textures,flow,stabilized);
  for(const [frame,uniform]of [[a,shader.uniforms.walkTrimA],[b,shader.uniforms.walkTrimB]] as const){
   const offset=stabilized?frame.visualOffsetPx??[0,0]:[0,0];
   assert.equal(uniform.value.x,(frame.trim[0]+offset[0]!)/512);assert.equal(uniform.value.y,(frame.trim[1]+offset[1]!)/640);
  }
  const pair=data.pairs.find((p:{from:string})=>p.from===a.id)!,rect=guarded?(stabilized?pair.guardedRect:pair.rawGuardedRect):(stabilized?pair.rect:pair.rawRect);
  assert.equal(shader.uniforms.walkFlowRect.value.x,(rect[0]+.5)/data.width);assert.equal(shader.uniforms.walkFlowRect.value.y,(rect[1]+.5)/data.height);
 }
 material.dispose();flow.texture.dispose();
});


test('smoothing follows variable frame holds, joins the loop and keeps terminal non-loop poses',async()=>{
 const m=await manifest('ink-hero'),c=resolveClip(m,'walk','d45');
 assert.deepEqual(sampleWalkBlend(c,1000*2.5/60,'original'),{from:'walk-01',to:'walk-02',mix:0,motion:false,guarded:false});
 assert.equal(sampleWalkBlend(c,c.durationsMs[0]!*.5,'crossfade').mix,.5);
 assert.equal(sampleWalkBlend(c,c.durationsMs[0]!*.5,'dissolve').mix,0);
 assert.ok(Math.abs(sampleWalkBlend(c,c.durationsMs[0]!*.9,'dissolve').mix-.5)<1e-10);
 assert.equal(sampleWalkBlend(c,c.durationsMs[0]!+.001,'crossfade').from,'walk-02');
 assert.equal(sampleWalkBlend(c,975,'motion').to,'walk-01');assert.ok(Math.abs(sampleWalkBlend(c,975,'motion').mix-.5)<1e-10);
 for(const mode of Object.keys(walkBlendModes) as (keyof typeof walkBlendModes)[]){
  const a=sampleWalkBlend(c,1000-.001,mode),b=sampleWalkBlend(c,1000+.001,mode);
  assert.equal(a.to,b.from);if(mode!=='original')assert.ok(a.mix>.999);
  assert.equal(sampleWalkBlend({...c,loop:false},5000,mode).to,'walk-16');
  assert.equal(sampleWalkBlend(c,-10,mode).mix,0);
 }
});

test('smoothing uses a shared registered canvas and returns exactly to original trimmed geometry/UVs',async()=>{
 const m=await manifest('ink-hero'),textures=new Map(m.pages.map(p=>[p.id,new Texture()])),c=resolveClip(m,'walk','d45');
 const s=new ActorSprite('blend-test',m,textures,c),foot=new Vector3(1,.225,-1),camera=makeCamera(16/9);
 s.animator.seek(75);s.showAnimation(foot,camera);
 const positions=Array.from(s.geometry.getAttribute('position').array),uvs=Array.from(s.geometry.getAttribute('uv').array);
 for(const mode of ['crossfade','dissolve','motion','eased','guarded','guarded-short'] as const){
  s.showAnimation(foot,camera,mode);assert.deepEqual(s.mesh.position.toArray(),foot.toArray());
  const full=trimmedBounds(m.asset,[0,0,...m.asset.canvas]),p=s.geometry.getAttribute('position');
  assert.ok(Math.abs(p.getX(0)-full.left)<1e-6);assert.ok(Math.abs(p.getY(0)-full.top)<1e-6);
  assert.equal(s.edgeMesh!.geometry,s.geometry);assert.equal(s.material.depthWrite,true);assert.equal(s.edgeMaterial!.depthWrite,false);
  s.showAnimation(foot,camera,'original');assert.deepEqual(Array.from(s.geometry.getAttribute('position').array),positions);assert.deepEqual(Array.from(s.geometry.getAttribute('uv').array),uvs);
 }
 s.animator.start(resolveClip(m,'rest','d45'));s.showAnimation(foot,camera,'motion');assert.equal(s.lastFrame,'walk-05');s.dispose();
});

test('motion fields cover all sixteen adjacent pairs including wrap, and retain source/output hashes',async()=>{
 const d=readRegistration().walk,data=await readAsset('staging/walk-blending/flow.png'),png=await sharp(data).metadata();
 assert.equal(hash(data),d.sha256);assert.equal(data.length,d.bytes);assert.equal(png.width,d.width);assert.equal(png.height,d.height);assert.equal(png.channels,4);
 assert.equal(d.pairs.length,16);assert.equal(Object.keys(d.sourceHashes).length,16);
 for(const [i,p] of d.pairs.entries()){
  assert.equal(p.from,`walk-${String(i+1).padStart(2,'0')}`);assert.equal(p.to,`walk-${String((i+1)%16+1).padStart(2,'0')}`);
  assert.ok(p.rect[0]>=0&&p.rect[1]>=0&&p.rect[0]+p.rect[2]<=d.width&&p.rect[1]+p.rect[3]<=d.height);
 }

 const pixels=await sharp(data).raw().toBuffer();
 for(const p of d.pairs){
  for(const key of ['rect','rawRect','guardedRect','rawGuardedRect'] as const){const [x,y,w,h]=p[key];assert.ok(x>=0&&y>=0&&x+w<=d.width&&y+h<=d.height);}
  for(const key of ['guardedRect','rawGuardedRect'] as const){const [x,y,w,h]=p[key];for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*d.width+xx)*4;for(const channel of [0,2])assert.ok(Math.hypot(pixels[i+channel]!-128,pixels[i+channel+1]!-128)*2<=24);}}
 }
});

test('weighted/relaxed rhythms keep all drawings, balanced half strides and current pose on switching',async()=>{
 const m=await manifest('ink-hero'),source=resolveClip(m,'walk','d45');
 assert.equal(timedWalk(source,'supplied'),source);
 for(const timing of ['weighted','relaxed'] as const){
  const changed=timedWalk(source,timing);assert.equal(timedWalk(source,timing),changed);assert.equal(changed.frames,source.frames);
  assert.deepEqual(changed.durationsMs.slice(0,8),changed.durationsMs.slice(8));assert.ok(changed.durationsMs.every(x=>x>0));
  assert.ok(Math.abs(clipDuration(changed)-(timing==='weighted'?1000:1100))<1e-9);
  let time=0;for(let i=0;i<16;i++){
   const before=time+source.durationsMs[i]!*.37+3*clipDuration(source),after=remapWalkTime(source,changed,before);
   assert.equal(frameAt(changed,after),source.frames[i]);assert.ok(Math.abs(remapWalkTime(changed,source,after)-before)<1e-8);time+=source.durationsMs[i]!;
  }
 }
 const weighted=walkTimings.weighted.ticks;assert.ok(weighted[0]>walkTimings.supplied.ticks[0]);assert.ok(weighted[2]>walkTimings.supplied.ticks[2]);assert.ok(weighted[1]<walkTimings.supplied.ticks[1]);
 assert.throws(()=>timedWalk({...source,frames:source.frames.slice(0,8)},'weighted'));
});

test('stronger registration fixes the idle pose and limits added vertical correction; sword endpoints follow each frame',async()=>{
 const config=JSON.parse(await readAsset('authoring/walk-tuning.json','utf8')),m=await manifest('ink-hero');
 assert.deepEqual(config.frames[4].visualOffsetPx,[0,0]);
 for(const f of config.frames){assert.ok(Math.abs(f.visualOffsetPx[1]-f.suppliedOffsetPx[1])<=5);assert.equal(f.sword.length,4);assert.ok(Math.hypot(f.sword[2]-f.sword[0],f.sword[3]-f.sword[1])>100);}
 const data=readRegistration().walk;assert.equal(data.tuningHash,hash(await readAsset('authoring/walk-tuning.json')));
 const a=m.frames[13]!,b=m.frames[14]!,pair=data.pairs[13]!,parameters=registeredSword(pair.sword,a,b,true);
 assert.deepEqual(parameters.a,[pair.sword.a[0]+a.visualOffsetPx![0],pair.sword.a[1]+a.visualOffsetPx![1],pair.sword.a[2]+a.visualOffsetPx![0],pair.sword.a[3]+a.visualOffsetPx![1]]);
 assert.deepEqual(registeredSword(pair.sword,a,b,false).a,pair.sword.a);
 const textures=new Map(m.pages.map(p=>[p.id,new Texture()])),material=new MeshBasicMaterial(),shader=new WalkBlendShader([material]),flow={...data,texture:new Texture()};
 const sample={from:a.id,to:b.id,mix:.37,motion:true,guarded:true};shader.update(sample,m,a,b,textures,flow,true,true);assert.equal(shader.uniforms.walkSwordEnabled.value,1);
 shader.update(sample,m,a,b,textures,flow,true,false);assert.equal(shader.uniforms.walkSwordEnabled.value,0);
 shader.update({...sample,guarded:false},m,a,b,textures,flow,true,true);assert.equal(shader.uniforms.walkSwordEnabled.value,0);
 material.dispose();flow.texture.dispose();
});

test('backward arm apex removes the extra reversal while preserving head/torso pixels and source keys',async()=>{
 const tuning=JSON.parse(await readAsset('authoring/walk-tuning.json','utf8')),frames=tuning.frames,c=frames[1].armCorrection;
 const registered=(i:number)=>frames[i].sword[0]+frames[i].visualOffsetPx[0];
 assert.ok(registered(0)<=registered(1)&&registered(1)<=registered(2),'apex must not go back-forward-back');
 const shift=armDisplacement(153,394,c);assert.deepEqual(shift,c.shift);
 assert.deepEqual(armDisplacement(280,320,c),[0,0]);

});
