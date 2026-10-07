import {readAsset,writeAsset,mkdirAsset} from './assets/io';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {correctWalkArm,type ArmCorrection} from './walk-arm-correction';
import {compile,hash,exactSource} from './compiler';
import type {Source} from '../src/assets/schema';
import {sceneryRegistration,restRegistration} from '../src/content/scenery-registration';
import {contract,HEADINGS} from '../src/core/camera';
const collection='references/art/ink-collection-01';
const staging='staging/ink';
const canonicalHash='74ba2c2004e5b30da8c35f192fd725957a2a24f8b26de0ad58163608cb7dd09c';
const check=process.argv.includes('--check');
const sourceMetadata:Record<string,unknown>[]=[];
async function read(relative:string){return exactSource(relative,collection);}
async function json(relative:string){return JSON.parse((await read(relative)).toString());}
async function write(file:string,data:Buffer|string){
  if(check){if(Buffer.compare(Buffer.from(data),await readAsset(file)))throw new Error(`stale prepared input: ${file}`);}
  else{await mkdirAsset(path.dirname(file),{recursive:true});await writeAsset(file,data);}
}
function source(id:string,type:Source['asset']['type'],canvas:[number,number],anchor:[number,number],density:number,viewMode:NonNullable<Source['asset']['viewMode']>='fixed-authored'):Source{
 return {schemaVersion:2,asset:{id,type,schemaVersion:2,contentVersion:'ink-01',bundle:id==='ink-hero'?'hero':'room',status:'proxy',viewMode,projection:type==='effect'?'projected-world':type==='material'?'top-down':'painted-cutout',allowEmptyFrames:type==='effect',atlasSize:type==='material'?512:type==='character'?1024:2048,limitations:['Imported reviewed study; painted camera and world registration remain provisional.','Source artwork unchanged; runtime derivatives use recorded uniform resampling and padding.'],provenance:{creator:'Lantern Ink collection authors',license:'Owner-supplied project artwork; original provenance and license declarations preserved in collection manifests.',source:collection},contractId:contract.id,bakeVersion:contract.bakeVersion,canvas,density,anchor,padding:4,colorSpace:'srgb',alpha:'straight',recipe:'prepare-ink-v4 / sharp-0.35.5',designReference:id.startsWith('ink-hero')?'libfile_0da5071239448191b6962495ce1e0164':'collection-study',renderStyle:'clean-ink',...(id.startsWith('ink-hero')?{canonicalReferenceHash:canonicalHash}:{}),renderCategory:type==='material'?'opaque':type==='effect'?'translucent':'cutout',shadow:{radius:.34,opacity:.32},collisionFootprint:type==='character'?'actor-definition':'none',occlusion:type==='material'?'ground-plane-v1':type==='effect'?'camera-card-v1':'vertical-plane-preserved-projection-v1',fallbacks:{},dependencies:[],requiredClips:[],clips:{}},frames:[]};
}
async function image(pack:Source,id:string,relative:string,options:{width?:number;height?:number;anchor?:[number,number];canvas?:[number,number];vectorScale?:number;sourceRoot?:string;armCorrection?:ArmCorrection}={}){
 const native=await exactSource(relative,options.sourceRoot??collection),m=await sharp(native).metadata();
 let rendered=options.armCorrection?await correctWalkArm(native,options.armCorrection):native,scale=1,offset:[number,number]=[0,0];
 if(options.vectorScale){rendered=await sharp(native,{density:72*options.vectorScale}).ensureAlpha().png().toBuffer();scale=options.vectorScale;}
 if(options.width||options.height){rendered=await sharp(native).resize({width:options.width,height:options.height,fit:'inside'}).ensureAlpha().png().toBuffer();const r=await sharp(rendered).metadata();scale=r.width!/m.width!;}
 if(options.canvas&&options.anchor){const r=await sharp(rendered).metadata();offset=[Math.round(pack.asset.anchor[0]-options.anchor[0]*scale),Math.round(pack.asset.anchor[1]-options.anchor[1]*scale)];
  if(offset[0]<0||offset[1]<0||offset[0]+r.width!>options.canvas[0]||offset[1]+r.height!>options.canvas[1])throw new Error(`normalization exceeds canvas: ${id}`);
  rendered=await sharp({create:{width:options.canvas[0],height:options.canvas[1],channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:rendered,left:offset[0],top:offset[1]}]).png().toBuffer();
 }
 const file=`ink/${pack.asset.id}/${id}.png`;await write(`staging/${file}`,rendered);
 pack.frames.push({id,path:file,origin:'imported-study',attachments:{}});
 sourceMetadata.push({pack:pack.asset.id,id,source:relative,...(options.sourceRoot?{sourceRoot:options.sourceRoot}:{}),sourceHash:hash(native),sourceCanvas:[m.width,m.height],derivativeCanvas:pack.asset.canvas,uniformScale:scale,derivativeAnchor:pack.asset.anchor,paddingOffset:offset,sourceAnchor:options.anchor??pack.asset.anchor,density:pack.asset.density,projection:pack.asset.projection});
 return id;
}
function still(pack:Source,id:string){pack.asset.clips[id]={d45:{frames:[id],durationsMs:[1000],loop:true,notifies:[]}};}
const packs:Source[]=[];
// Native sixteen-drawing sequence; offsets affect presentation only.
const walkRoot='references/art/rust_16_frame_drawing_walk_prototype';
const walkReceipt=JSON.parse((await exactSource('import-receipt.json',walkRoot)).toString()) as {files:Record<string,string>};
for(const [file,expected] of Object.entries(walkReceipt.files))if(hash(await exactSource(file,walkRoot))!==expected)throw new Error(`walk source hash differs: ${file}`);
const walk=JSON.parse((await exactSource('timing_and_registration.json',walkRoot)).toString()) as {
 canvas_px:[number,number];root_pivot_px_top_left:[number,number];presentation_fps:number;
 holds_60hz:number[];known_issues:string[];frames:{index:number;file:string}[];
};
const offsets=JSON.parse((await exactSource('Lantern_Walk_16_Optional_Offsets.json',walkRoot)).toString()) as {
 frames:{frame_index_1based:number;file:string;offset_x_px:number;offset_y_px:number}[];
};
const tuning=JSON.parse(await readAsset('authoring/walk-tuning.json','utf8')) as {frames:{index:number;visualOffsetPx:[number,number];armCorrection?:ArmCorrection}[]};
if(walk.frames.length!==16||offsets.frames.length!==16)throw new Error('sixteen registered walk drawings and offsets required');
const hero=source('ink-hero','character',walk.canvas_px,walk.root_pivot_px_top_left,(572-82)/(1.8*Math.cos(contract.elevationDeg*Math.PI/180)));
hero.asset.contentVersion='rust-walk-density16-03';hero.asset.provenance.source=walkRoot;
hero.asset.limitations=['One approximate authored walk; no idle or action animation. Rest holds original passing drawing 03 (sequence frame 05).','Visual stabilization is reversible; source pose/prop differences and foot sliding remain approximate.',...walk.known_issues];
const walkIds=[];
for(const f of walk.frames){
 const offset=offsets.frames.find(o=>o.frame_index_1based===f.index);
 if(!offset||offset.file!==path.basename(f.file))throw new Error(`walk offset mapping differs: ${f.file}`);
 const tuned=tuning.frames.find(t=>t.index===f.index);
 walkIds.push(await image(hero,`walk-${String(f.index).padStart(2,'0')}`,f.file,{sourceRoot:walkRoot,armCorrection:tuned?.armCorrection}));if(!tuned)throw new Error(`walk tuning missing frame: ${f.index}`);
 hero.frames.at(-1)!.visualOffsetPx=tuned.visualOffsetPx;
 Object.assign(sourceMetadata.at(-1)!,{visualOffsetPx:hero.frames.at(-1)!.visualOffsetPx,visualOffsetSource:'authoring/walk-tuning.json',suppliedVisualOffsetPx:[offset.offset_x_px,offset.offset_y_px],...(tuned.armCorrection?{armCorrection:tuned.armCorrection}:{} )});
}
hero.asset.clips.walk={d45:{frames:walkIds,durationsMs:walk.holds_60hz.map(t=>1000*t/walk.presentation_fps),loop:true,notifies:[]}};
hero.asset.clips.rest={d45:{frames:['walk-05'],durationsMs:[1000],loop:true,notifies:[]}};packs.push(hero);
const enemy=source('ink-revenant','character',[612,564],[687*612/1374,1169*564/1267],(1156-83)*564/1267/(1.8*Math.cos(contract.elevationDeg*Math.PI/180)));
await image(enemy,'rest','import_padded/02_enemies/04_iron_revenant.png',{width:612,height:564,anchor:[687,1169]});still(enemy,'rest');packs.push(enemy);
const skeleton=source('ink-skeleton','character',[1024,1536],[480,1260],(1260-280)/(1.7*Math.cos(contract.elevationDeg*Math.PI/180)));
skeleton.asset.atlasSize=2048;
await image(skeleton,'rest','packs/02_enemies/assets/02_skeleton_halberdier.png');still(skeleton,'rest');packs.push(skeleton);
const idle=source('ink-hero-idle-study','character',[249,640],[272*249/466,1084*640/1198],(1084-35)*640/1198/(1.8*Math.cos(contract.elevationDeg*Math.PI/180)));idle.asset.atlasSize=2048;
const study=await json('Lantern_Hero_KnownView_Idle_Study_v01/layered2d/study_manifest_native.json');
const idleIds=[];
for(const f of study.frames)idleIds.push(await image(idle,`idle-${f.index}`,`Lantern_Hero_KnownView_Idle_Study_v01/layered2d/${f.file}`,{width:249,height:640,anchor:[272,1084]}));
idle.asset.clips.idle={d45:{frames:idleIds,durationsMs:study.frames.map((f:{duration_ticks:number;timebase_hz:number})=>1000*f.duration_ticks/f.timebase_hz),loop:true,notifies:[]}};packs.push(idle);
// One shared prop canvas/density; anchors shift with each uniformly resized image.
const props=source('ink-scenery','prop',[3072,3072],[1536,2750],356);props.asset.atlasSize=4096;
const layout=await json('Lantern_Crypt_Entry_CleanInk_v02/scene_layout.json');
for(const registration of sceneryRegistration){const {id,file,height,measurePx}=registration;
 const asset=file.split('/').at(-1)!.replace('.png','');let pivot='pivot' in registration?registration.pivot:layout.cards.find((c:{asset:string})=>c.asset===asset)?.pivot_px;
 if(!pivot){const b=await sharp(await read(file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});let min=Infinity,max=-1,bottom=0;for(let y=0;y<b.info.height;y++)for(let x=0;x<b.info.width;x++)if(b.data[(y*b.info.width+x)*4+3]!>128){min=Math.min(min,x);max=Math.max(max,x);bottom=Math.max(bottom,y);}pivot=[(min+max)/2,bottom];}
 const metadata=await sharp(await read(file)).metadata(),scale=height*Math.cos(contract.elevationDeg*Math.PI/180)*props.asset.density/measurePx;
 await image(props,id,file,{height:Math.round(metadata.height!*scale),anchor:pivot,canvas:props.asset.canvas});still(props,id);
 Object.assign(sourceMetadata.at(-1)!,{physicalHeightMetres:height,measurementPixels:measurePx,...('sockets' in registration?{sourceConnectionSockets:registration.sockets}:{})});
}packs.push(props);
const restRoot='references/art/lanternkeepers-rest-v1';
const restReceipt=JSON.parse(await readAsset(`${restRoot}/provenance.json`,'utf8')) as {files:{file:string;sha256:string}[]};
for(const f of restReceipt.files)if(hash(await exactSource(f.file,restRoot))!==f.sha256)throw new Error(`native Rest source changed: ${f.file}`);
const rest=source('ink-rest','prop',[3072,3072],[1200,2500],356);rest.asset.atlasSize=4096;rest.asset.contentVersion='rest-v1';rest.asset.provenance.source=restRoot;rest.asset.provenance.creator='Built-in image_gen; original Lantern ink prompts and artwork used as style references';
for(const r of restRegistration){const m=await sharp(await exactSource(r.file,restRoot)).metadata(),scale=r.height*Math.cos(contract.elevationDeg*Math.PI/180)*rest.asset.density/r.measurePx;
 await image(rest,r.id,r.file,{sourceRoot:restRoot,height:Math.round(m.height!*scale),anchor:r.pivot,canvas:rest.asset.canvas});still(rest,r.id);Object.assign(sourceMetadata.at(-1)!,{physicalHeightMetres:r.height,measurementPixels:r.measurePx,...('sockets' in r?{sourceConnectionSockets:r.sockets}:{})});
}packs.push(rest);
const soilNative=await sharp(await exactSource('grave-soil-v1.png',restRoot)).metadata();
const soil=source('ink-soil','prop',[soilNative.width!,soilNative.height!],[soilNative.width!/2,soilNative.height!/2],700);soil.asset.projection='top-down';soil.asset.occlusion='ground-plane-v1';soil.asset.renderCategory='translucent';soil.asset.provenance.source=restRoot;await image(soil,'grave-soil','grave-soil-v1.png',{sourceRoot:restRoot});still(soil,'grave-soil');packs.push(soil);
for(const id of ['ink-floor-court','ink-floor-landing']){const mat=source(id,'material',[1024,1024],[512,512],256);mat.asset.atlasSize=1024;mat.asset.provenance.source=restRoot;mat.asset.contentVersion='rest-v1';await image(mat,'surface','paving-v1.png',{sourceRoot:restRoot,width:1024,height:1024});still(mat,'surface');packs.push(mat);}
const wood=source('ink-wood','material',[1024,1024],[512,512],256);wood.asset.atlasSize=1024;await image(wood,'surface','Ground_Surfaces_Decals_r02a/png/materials/04_wood_plank_floor.png');still(wood,'surface');packs.push(wood);
const grass=source('ink-moss','material',[1024,1024],[512,512],256);grass.asset.atlasSize=1024;grass.asset.provenance.source=restRoot;await image(grass,'surface','grass-v1.png',{sourceRoot:restRoot,width:1024,height:1024});still(grass,'surface');packs.push(grass);
const masonry=source('ink-masonry','material',[1024,512],[512,256],320);masonry.asset.atlasSize=1024;await image(masonry,'surface','limestone-face.png',{sourceRoot:'staging/rest'});Object.assign(sourceMetadata.at(-1)!,{minimumSourceDensity:313/1.1,materialReceipt:'staging/rest/receipt.json'});still(masonry,'surface');packs.push(masonry);
const decals=source('ink-decals','prop',[1024,1024],[512,512],256);decals.asset.projection='top-down';decals.asset.occlusion='ground-plane-v1';decals.asset.renderCategory='translucent';
for(const id of ['d01_branching_crack','d03_moss_edge','d04_moss_islands','d05_leaf_drift','d08_dirt_scuffs']){await image(decals,id,`Ground_Surfaces_Decals_r02a/png/decals/${id}.png`,{anchor:[512,512]});still(decals,id);}packs.push(decals);
const transitions=source('ink-ground-transitions','prop',[1024,1024],[512,512],256);transitions.asset.projection='top-down';transitions.asset.occlusion='ground-plane-v1';transitions.asset.renderCategory='translucent';
for(const id of ['t01_earth_stone_border','t02_moss_invasion','t03_broken_pavement_edge','t04_plank_threshold','t07_damp_spread','t08_crossing_root','t09_forked_roots']){await image(transitions,id,`Ground_Transitions/png/overlays/${id}.png`);still(transitions,id);}packs.push(transitions);
const wall=source('ink-wall-face','prop',[1024,1024],[512,1024],256);wall.asset.projection='front-view';wall.asset.occlusion='wall-face-v1';wall.asset.atlasSize=2048;await image(wall,'face','Wall_Dressing/png/faces/w01_arched_stained_glass.png',{anchor:[512,1024]});still(wall,'face');packs.push(wall);
// Crypt selections are independent packs: exterior registrations and original art stay intact.
for(const [id,file]of [['ink-crypt-stone','02_cracked_cathedral_stone'],['ink-crypt-damp','05_damp_cellar_stone'],['ink-crypt-marble','09_pale_crypt_marble']] as const){
 const p=source(id,'material',[1024,1024],[512,512],256);p.asset.atlasSize=1024;p.asset.sampling='terrain-mipmapped';
 await image(p,'surface',`Ground_Surfaces_Decals_r02a/png/materials/${file}.png`);still(p,'surface');packs.push(p);
}
const crypt=source('ink-crypt','prop',[3072,3072],[1536,2750],356);crypt.asset.atlasSize=4096;
const cryptItems=[
 {id:'bier',file:'volume_12_crypt/assets/crypt_low_wooden_bier_01.png',height:.58,measurePx:390},
 {id:'lid',file:'volume_12_crypt/assets/crypt_leaning_sarcophagus_lid_01.png',height:1.3,measurePx:1150},
 {id:'bones',file:'volume_12_crypt/assets/crypt_restrained_bone_pile_01.png',height:.22,measurePx:430},
 {id:'votive-hardware',file:'Lantern_Lighting03_CleanInk/png/votive_candelabrum_unlit.png',height:.48,measurePx:530,pivot:[770,1240] as [number,number]},
 {id:'cresset-hardware',file:'Lantern_Lighting03_CleanInk/png/wall_cresset_unlit.png',height:.45,measurePx:390,pivot:[780,995] as [number,number]},
];
for(const r of cryptItems){const native=await read(r.file),raw=await sharp(native).ensureAlpha().raw().toBuffer({resolveWithObject:true});let l=Infinity,right=-1,bottom=0;
 for(let y=0;y<raw.info.height;y++)for(let x=0;x<raw.info.width;x++)if(raw.data[(y*raw.info.width+x)*4+3]!>128){l=Math.min(l,x);right=Math.max(right,x);bottom=Math.max(bottom,y);}
 const pivot=r.pivot??[(l+right)/2,bottom] as [number,number],scale=r.height*Math.cos(contract.elevationDeg*Math.PI/180)*crypt.asset.density/r.measurePx;
 await image(crypt,r.id,r.file,{height:Math.round(raw.info.height*scale),anchor:pivot,canvas:crypt.asset.canvas});still(crypt,r.id);
 Object.assign(sourceMetadata.at(-1)!,{physicalHeightMetres:r.height,measurementPixels:r.measurePx});
}
// A fixed doorway owns its shared pixels once; actors still occlude the assembly.
const doorParts=await Promise.all(['door-closed','arch'].map(async id=>({id,bytes:await exactSource(`${id}.png`,'staging/ink/ink-scenery')})));
const doorway=await sharp({create:{width:3072,height:3072,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(doorParts.map(p=>({input:p.bytes,left:0,top:0}))).png().toBuffer();
await write('staging/ink/ink-crypt/doorway.png',doorway);crypt.frames.push({id:'doorway',path:'ink/ink-crypt/doorway.png',origin:'imported-study',attachments:{}});still(crypt,'doorway');
sourceMetadata.push({pack:crypt.asset.id,id:'doorway',source:'registered-doorway-composite',sourceHash:hash(doorway),sourceCanvas:crypt.asset.canvas,derivativeCanvas:crypt.asset.canvas,uniformScale:1,derivativeAnchor:crypt.asset.anchor,paddingOffset:[0,0],sourceAnchor:crypt.asset.anchor,density:crypt.asset.density,projection:crypt.asset.projection,sourceParts:doorParts.map(p=>({file:`staging/ink/ink-scenery/${p.id}.png`,sha256:hash(p.bytes)}))});
packs.push(crypt);
const cryptWall=source('ink-crypt-wall','prop',[1024,1024],[512,1024],256);cryptWall.asset.projection='front-view';cryptWall.asset.occlusion='wall-face-v1';cryptWall.asset.atlasSize=2048;
const cryptFeature=source('ink-crypt-feature','prop',[1024,1024],[512,512],256);cryptFeature.asset.projection='top-down';cryptFeature.asset.occlusion='ground-plane-v1';cryptFeature.asset.renderCategory='translucent';
await image(cryptFeature,'puddle','Floor_Features/png/features/f07_shallow_puddle_bed.png');still(cryptFeature,'puddle');packs.push(cryptFeature);
for(const [id,file]of [['glass','w01_arched_stained_glass'],['niche','w06_carved_stone_niche_back'],['mural','w04_faded_mural_fragment'],['plaster','w07_peeling_plaster_patch']] as const){await image(cryptWall,id,`Wall_Dressing/png/faces/${file}.png`);still(cryptWall,id);}packs.push(cryptWall);
const flames=source('ink-crypt-flame','effect',crypt.asset.canvas,crypt.asset.anchor,crypt.asset.density);flames.asset.projection='painted-cutout';flames.asset.atlasSize=2048;
const flameClip=(await json('Lantern_Lighting03_CleanInk/animation/clips.json')).find((c:{asset:string})=>c.asset==='votive_candelabrum');
const candle=cryptItems.find(r=>r.id==='votive-hardware')!,candleScale=candle.height*Math.cos(contract.elevationDeg*Math.PI/180)*crypt.asset.density/candle.measurePx;
const flameIds=[];for(const [i,f]of flameClip.frames.entries())flameIds.push(await image(flames,`votive-${i}`,`Lantern_Lighting03_CleanInk/${f.emission_file}`,{height:Math.round(1536*candleScale),anchor:candle.pivot,canvas:flames.asset.canvas}));
flames.asset.clips.votive={d45:{frames:flameIds,durationsMs:flameClip.frames.map((f:{duration_ms:number})=>f.duration_ms),loop:true,notifies:[]}};packs.push(flames);
async function effects(id:string,folder:string,selected:string[],directional:boolean){
 const data=await json(`${folder}/manifest.json`),p=source(id,'effect',[1536,1344],[768,858],336,directional?'directional':'fixed-authored');
 for(const c of data.clips){const base=c.effect??c.id.split('__')[0];if(!selected.includes(base))continue;
  const heading=directional?HEADINGS[Math.round(c.headingDegrees/45)%8]!:'d45';const frames=[];
  for(const f of c.frames){const frameId=`${base.replaceAll('_','-')}-${heading}-${f.id}`;frames.push(await image(p,frameId,`${folder}/${f.svg}`,{vectorScale:3,anchor:[256,286]}));}
  const clip={frames,durationsMs:c.frames.map((f:{durationRational?:number[];durationSeconds?:number})=>f.durationRational?1000*f.durationRational[0]!/f.durationRational[1]!:1000*f.durationSeconds!),loop:!!c.loop,notifies:[]};
  (p.asset.clips[base]??={})[heading]=clip;
 }
 packs.push(p);
}
await effects('ink-combat','combat',['sword_arc_01','sword_arc_02','sword_finisher_03','lantern_cone_flare'],true);
const combat=packs.at(-1)!,combatStudy=structuredClone(combat);combatStudy.asset.id='ink-combat-study';packs.push(combatStudy);
combat.asset.clips=Object.fromEntries(Object.entries(combat.asset.clips).filter(([id])=>['sword_arc_01','lantern_cone_flare'].includes(id)));
const activeCombatFrames=new Set(Object.values(combat.asset.clips).flatMap(dirs=>Object.values(dirs).flatMap(c=>c!.frames)));combat.frames=combat.frames.filter(f=>activeCombatFrames.has(f.id));
await effects('ink-cues','interaction_pack_v1',['enemy_ring','door_seal_dissolve'],false);
await effects('ink-crypt-ambient','ambient_pack_v1',['lamp_flame','rising_motes','droplet_splash','pond_ripple'],false);
await write(`${staging}/derivatives.json`,JSON.stringify({recipe:'prepare-ink-v4',frames:sourceMetadata},null,2)+'\n');
for(const p of packs){p.asset.requiredClips=Object.keys(p.asset.clips);await write(`${staging}/${p.asset.id}.json`,JSON.stringify(p,null,2)+'\n');
 const out=`public/generated/ink/${p.asset.id}`;const compiled=await compile(`ink/${p.asset.id}.json`,out,false,check);
 if(check){const published=JSON.parse(await readAsset(`${out}/manifest.json`,'utf8'));if(JSON.stringify(compiled)!==JSON.stringify(published))throw new Error(`stale compiled pack: ${p.asset.id}`);
  for(const page of compiled.pages)if(hash(await readAsset(path.join(out,page.path)))!==page.hash)throw new Error(`stale page: ${p.asset.id}/${page.id}`);
 }
 console.log(`${check?'Verified':'Prepared'} ${p.asset.id}: ${p.frames.length} frames / ${compiled.pages.length} pages`);
}
