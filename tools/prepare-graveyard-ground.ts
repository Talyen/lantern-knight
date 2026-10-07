import {readAsset,writeAsset,mkdirAsset} from './assets/io';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {compile,hash} from './compiler';
import {graveyardScene} from '../src/content/graveyard-scene';
import type {Source} from '../src/assets/schema';

const check=process.argv.includes('--check'),root='references/art/ink-collection-01',size=2048,density=256;
const layout={asset:'ink-graveyard-ground-proof',min:-16,tileSize:8,count:4},inputs:Record<string,string>={};
async function pixels(file:string,brightness=1,saturation=1){const b=await readAsset(file);inputs[file]=hash(b);return sharp(b).modulate({brightness,saturation}).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
const grass=await pixels('references/art/blackwood-churchyard-v2/quiet-earth.png',.88,.6);
const earth=await pixels('references/art/blackwood-churchyard-v2/quiet-earth.png',1.02,.45);
const paving=await pixels(`${root}/Ground_Surfaces_Decals_r02a/png/materials/03_worn_cobble.png`,1.02,.60);
const apron=await pixels(`${root}/Ground_Surfaces_Decals_r02a/png/materials/01_old_flagstone.png`,.82,.6);
const soil=await pixels('references/art/lanternkeepers-rest-v1/grave-soil-v1.png',1.1,.65);
const overlays=await Promise.all(graveyardScene.decals.map(async p=>({placement:p,image:await pixels(`${root}/${p.clip.startsWith('t')?'Ground_Transitions/png/overlays':'Ground_Surfaces_Decals_r02a/png/decals'}/${p.clip}.png`,.88,.7)})));
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(a:number,b:number,v:number)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
function sample(im:typeof grass,x:number,z:number,repeat=4){const u=((x/repeat)%1+1)%1,v=((z/repeat)%1+1)%1;return (Math.floor(v*im.info.height)*im.info.width+Math.floor(u*im.info.width))*4;}
function pathGap(x:number,z:number){let nearest=Infinity;for(const route of graveyardScene.paths)for(let i=1;i<route.points.length;i++){const a=route.points[i-1]!,b=route.points[i]!,dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz));const width=route.widths?route.widths[i-1]!+(route.widths[i]!-route.widths[i-1]!)*t:route.width;nearest=Math.min(nearest,Math.hypot(x-a.x-dx*t,z-a.z-dz*t)-width/2);}return nearest;}
async function write(file:string,b:Buffer|string){if(check){if(!Buffer.from(b).equals(await readAsset(file)))throw new Error(`stale graveyard ground: ${file}`);}else{await mkdirAsset(path.dirname(file),{recursive:true});await writeAsset(file,b);}}
const template=JSON.parse(await readAsset('staging/ink/ink-moss.json','utf8')) as Source;
const source:Source={schemaVersion:2,asset:{...template.asset,id:layout.asset,contentVersion:'graveyard-v1',canvas:[size,size],anchor:[size/2,size/2],density,atlasSize:size,padding:0,sampling:'terrain-mipmapped',recipe:'graveyard-ground-v1',provenance:{...template.asset.provenance,source:'references/art/ink-collection-01; graveyard-scene.ts authored composition'},clips:{},requiredClips:[]},frames:[]};
if(process.argv.includes('--proof'))for(let tz=0;tz<layout.count;tz++)for(let tx=0;tx<layout.count;tx++){
 const raw=Buffer.alloc(size*size*4),left=layout.min+tx*layout.tileSize,top=layout.min+tz*layout.tileSize;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const wx=left+(x+.5)/density,wz=top+(y+.5)/density,index=(y*size+x)*4;
  const field=(Math.sin(wx*.43+wz*.31)+Math.sin(wx*.19-wz*.58)*.55+Math.sin(wx*.91+wz*.77)*.18)/1.73;
  const outside=smooth(7,15,Math.max(Math.abs(wx),Math.abs(wz))),damp=smooth(4.7,6.7,Math.abs(wx));
  const earthMix=clamp(.14+field*.13+damp*.12+outside*.20),g=sample(grass,wx,wz),e=sample(earth,wx,wz);
  let r=grass.data[g]!*(1-earthMix)+earth.data[e]!*earthMix,gg=grass.data[g+1]!*(1-earthMix)+earth.data[e+1]!*earthMix,b=grass.data[g+2]!*(1-earthMix)+earth.data[e+2]!*earthMix;
  const gap=pathGap(wx,wz)+(Math.sin(wx*11+wz*7)+Math.sin(wx*23-wz*17))*.025,route=1-smooth(-.035,.07,gap),pa=sample(paving,wx,wz,4),threshold=clamp(Math.min(wx+1.55,1.55-wx,wz+6.5,-5.25-wz)/.05),ap=sample(apron,wx,wz,4);
  const stone=route*(1-threshold)+threshold;
  r=r*(1-stone)+(paving.data[pa]!*(1-threshold)+apron.data[ap]!*threshold)*stone;
  gg=gg*(1-stone)+(paving.data[pa+1]!*(1-threshold)+apron.data[ap+1]!*threshold)*stone;
  b=b*(1-stone)+(paving.data[pa+2]!*(1-threshold)+apron.data[ap+2]!*threshold)*stone;
  for(const plot of graveyardScene.graves){const a=plot.angle??0,dx=wx-plot.x,dz=wz-plot.z,lx=dx*Math.cos(a)-dz*Math.sin(a),lz=dx*Math.sin(a)+dz*Math.cos(a);if(Math.abs(lx)>plot.width/2||Math.abs(lz)>plot.length/2)continue;
   const sx=Math.min(soil.info.width-1,Math.floor((lx/plot.width+.5)*soil.info.width)),sy=Math.min(soil.info.height-1,Math.floor((lz/plot.length+.5)*soil.info.height)),n=(sy*soil.info.width+sx)*4;
   const opacity=soil.data[n+3]!/255*(plot.age==='kept'?.70:plot.age==='damaged'?.38:.20)*(1-stone);
   r=r*(1-opacity)+soil.data[n]!*opacity;gg=gg*(1-opacity)+soil.data[n+1]!*opacity;b=b*(1-opacity)+soil.data[n+2]!*opacity;
  }
  for(const {placement:p,image:im} of overlays){const scale=p.scale??1,a=p.rotation??0,dx=wx-p.x,dz=wz-p.z,lx=dx*Math.cos(a)-dz*Math.sin(a),lz=dx*Math.sin(a)+dz*Math.cos(a),w=4*scale;if(Math.abs(lx)>w/2||Math.abs(lz)>w/2)continue;const sx=Math.min(im.info.width-1,Math.floor((lx/w+.5)*im.info.width)),sy=Math.min(im.info.height-1,Math.floor((lz/w+.5)*im.info.height)),n=(sy*im.info.width+sx)*4,alpha=im.data[n+3]!/255;
   r=r*(1-alpha)+im.data[n]!*alpha;gg=gg*(1-alpha)+im.data[n+1]!*alpha;b=b*(1-alpha)+im.data[n+2]!*alpha;
  }
  raw[index]=Math.round(r);raw[index+1]=Math.round(gg);raw[index+2]=Math.round(b);raw[index+3]=255;
 }
 const id=`tile-${tx}-${tz}`,file=`ink/${layout.asset}/${id}.png`;await write(`staging/${file}`,await sharp(raw,{raw:{width:size,height:size,channels:4}}).png().toBuffer());source.frames.push({id,path:file,origin:'imported-study',attachments:{}});source.asset.clips[id]={d45:{frames:[id],durationsMs:[1000],loop:true,notifies:[]}};source.asset.requiredClips.push(id);
 console.log(`${check?'Verified':'Composed'} ${id}`);
}
const materials:Source={schemaVersion:2,asset:{...template.asset,id:'ink-graveyard-materials',contentVersion:'graveyard-v1',canvas:[1024,1024],anchor:[512,512],density:256,atlasSize:1024,padding:0,sampling:'terrain-mipmapped',recipe:'graveyard-ground-materials-v1',clips:{},requiredClips:[]},frames:[]};
for(const [id,im]of [['grass',grass],['earth',earth],['paving',paving],['apron',apron]] as const){const file=`ink/ink-graveyard-materials/${id}.png`;await write(`staging/${file}`,await sharp(im.data,{raw:im.info}).resize(1024,1024).png().toBuffer());materials.frames.push({id,path:file,origin:'imported-study',attachments:{}});materials.asset.clips[id]={d45:{frames:[id],durationsMs:[1000],loop:true,notifies:[]}};materials.asset.requiredClips.push(id);}
await write('staging/ink/ink-graveyard-materials.json',JSON.stringify(materials,null,2)+'\n');const materialManifest=await compile('ink/ink-graveyard-materials.json','public/generated/ink/ink-graveyard-materials',false,check);if(check&&JSON.stringify(materialManifest)!==JSON.stringify(JSON.parse(await readAsset('public/generated/ink/ink-graveyard-materials/manifest.json','utf8'))))throw new Error('stale graveyard materials');
const overlayPack:Source={schemaVersion:2,asset:{...template.asset,id:'ink-graveyard-overlays',type:'prop',contentVersion:'graveyard-v1',canvas:[1024,1024],anchor:[512,512],density:256,atlasSize:4096,renderCategory:'translucent',occlusion:'ground-plane-v1',sampling:undefined,recipe:'graveyard-ground-overlays-v1',clips:{},requiredClips:[]},frames:[]};
for(const {placement:p,image:im}of overlays.filter((v,i)=>overlays.findIndex(w=>w.placement.clip===v.placement.clip)===i)){const file=`ink/ink-graveyard-overlays/${p.clip}.png`;await write(`staging/${file}`,await sharp(im.data,{raw:im.info}).png().toBuffer());overlayPack.frames.push({id:p.clip,path:file,origin:'imported-study',attachments:{}});overlayPack.asset.clips[p.clip]={d45:{frames:[p.clip],durationsMs:[1000],loop:true,notifies:[]}};overlayPack.asset.requiredClips.push(p.clip);}
await write('staging/ink/ink-graveyard-overlays.json',JSON.stringify(overlayPack,null,2)+'\n');const overlayManifest=await compile('ink/ink-graveyard-overlays.json','public/generated/ink/ink-graveyard-overlays',false,check);if(check&&JSON.stringify(overlayManifest)!==JSON.stringify(JSON.parse(await readAsset('public/generated/ink/ink-graveyard-overlays/manifest.json','utf8'))))throw new Error('stale graveyard overlays');
if(source.frames.length){const file=`ink/${layout.asset}.json`;await write(`staging/${file}`,JSON.stringify(source,null,2)+'\n');const expected=await compile(file,`public/generated/ink/${layout.asset}`,false,check);if(check&&JSON.stringify(expected)!==JSON.stringify(JSON.parse(await readAsset(`public/generated/ink/${layout.asset}/manifest.json`,'utf8'))))throw new Error('stale ground proof');}
await write('staging/ink/graveyard-ground-receipt.json',JSON.stringify({recipe:'blackwood-ground-v2',inputs:Object.fromEntries(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b))),compositionHash:hash(JSON.stringify({paths:graveyardScene.paths,graves:graveyardScene.graves,decals:graveyardScene.decals})),layout,density,originalSourcesPreserved:true,runtimeSamplerSize:1024},null,2)+'\n');
