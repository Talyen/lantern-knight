import {readRegistration} from './assets/data';
import {readAsset} from './assets/io';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseManifest} from '../src/assets/schema';
import {assetCatalog,gameAssetCatalog} from '../src/content/visuals';
import {worldVisuals} from '../src/content/world-art';
import {content} from '../src/content/world';
import {contract} from '../src/core/camera';
const height=2160,minimumSpan=contract.framingRange[0]!,maximumSpan=contract.framingRange[1]!,minimumHeadroom=1;
const previousMinimumSpan=11,previousHeadroom=1.25;
const placements=Object.values(worldVisuals).flatMap(v=>v.props);
const derivatives=[...JSON.parse(await readAsset('staging/ink/derivatives.json','utf8')).frames,...JSON.parse(await readAsset('staging/ink/graveyard-art-receipt.json','utf8')).frames] as {pack:string;id:string;uniformScale:number;source:string;minimumSourceDensity?:number}[];
const largestPropScale=Math.max(1,...placements.map(p=>p.scale??1));
const largestCueScale=Math.max(1,...[...content.actors.values()].filter(a=>a.kind==='enemy').map(a=>a.melee.range/2));
const cases=Object.keys(assetCatalog).filter(id=>id.startsWith('ink-')).map(id=>({id,scale:id==='ink-scenery'?largestPropScale:id==='ink-cues'?largestCueScale:1}));
const rows=[];const runtimePages=new Map<string,{rgbaBytes:number;mipmaps:boolean}>();const residentPages=new Map<string,{rgbaBytes:number;mipmaps:boolean}>();
for(const {id,scale} of cases){const m=parseManifest(JSON.parse(await readAsset(`public/${assetCatalog[id]}`,'utf8')));
 for(const page of m.pages){const key=`${page.hash}:${page.width}x${page.height}`;residentPages.set(key,page);if(id in gameAssetCatalog)runtimePages.set(key,page);}
 const headroom=m.asset.density/(height/minimumSpan*scale);
 const sourceHeadroom=Math.min(...m.frames.map(frame=>{const d=derivatives.find(d=>d.pack===id&&d.id===frame.id),instanceScale=id==='ink-scenery'?Math.max(1,...placements.filter(p=>p.clip===frame.id).map(p=>p.scale??1)):scale;return Math.min(d?.minimumSourceDensity??Infinity,m.asset.density,d&&!d.source.endsWith('.svg')?m.asset.density/d.uniformScale:m.asset.density)/(height/minimumSpan*instanceScale);}));
 assert.ok(sourceHeadroom>=minimumHeadroom,`${id}: native source has only ${sourceHeadroom.toFixed(3)}x sampling headroom`);
 assert.ok(headroom>=minimumHeadroom,`${id} would undersample/upscale at span ${minimumSpan}: ${headroom.toFixed(3)}x; increase source resolution`);
 assert.ok(sourceHeadroom*previousMinimumSpan/minimumSpan>=previousHeadroom,`${id}: existing 11 m source headroom regressed`);
 assert.equal(m.asset.colorSpace,'srgb');assert.equal(m.asset.alpha,'straight');assert.ok(m.pages.every(p=>p.mipmaps===(m.asset.sampling==='terrain-mipmapped')),'sampling declarations and runtime pages must agree');
 rows.push({id,canvas:m.asset.canvas,density:m.asset.density,maxScale:scale,minimumStagedPixelsPerOutputPixel:headroom,minimumSourcePixelsPerOutputPixel:sourceHeadroom,baseRgbaBytes:m.pages.reduce((n,p)=>n+Math.ceil(p.rgbaBytes*(p.mipmaps?4/3:1)),0)});
}
const diagnostic=parseManifest(JSON.parse(await readAsset('public/generated/manifest.json','utf8')));
const flow=readRegistration().walk,motionFieldBytes=flow.width*flow.height*4;
const cryptSurfaceCloneBytes=Math.ceil(rows.find(r=>r.id==='ink-masonry')!.baseRgbaBytes*4/3);
const fullCatalogBaseBytes=cryptSurfaceCloneBytes+motionFieldBytes+[...residentPages.values()].reduce((n,p)=>n+p.rgbaBytes,0)+diagnostic.pages.reduce((n,p)=>n+p.rgbaBytes,0);
const mipmapBytes=[...residentPages.values()].filter(p=>p.mipmaps).reduce((n,p)=>n+Math.ceil(p.rgbaBytes/3),0),fullCatalogTextureBytes=fullCatalogBaseBytes+mipmapBytes;
const runtimeCatalogTextureBytes=cryptSurfaceCloneBytes+motionFieldBytes+[...runtimePages.values()].reduce((n,p)=>n+Math.ceil(p.rgbaBytes*(p.mipmaps?4/3:1)),0);
assert.ok(runtimeCatalogTextureBytes<=contract.budgets.sceneTextureMiB*1024*1024,'active game catalog including motion fields exceeds the provisional scene texture budget');
const report={runtimeCatalogTextureBytes,developmentGalleryLoadsOnDemand:true,fullCatalogBaseBytes,fullCatalogTextureBytes,mipmapBytes,motionFieldBytes,cryptSurfaceCloneBytes,provisionalTextureBudgetMiB:contract.budgets.sceneTextureMiB,drawingBuffer:[3840,height],framing:[minimumSpan,maximumSpan],minimumHeadroom,previousFramingHeadroom:{span:previousMinimumSpan,minimumHeadroom:previousHeadroom},colorSpace:'sRGB input/output with linear lighting/blending',alpha:'straight; opaque core and blended edge pass for imported cutouts',filtering:'linear packed cutouts; mipmapped standalone terrain; Crypt wall surface uses a separately owned mipmapped sampler',cameraContract:contract.id,assets:rows,limits:['Guarantee covers this drawing buffer and zoom range; arbitrary enlargement cannot invent source detail.','Source matte fringes remain until separately reviewed art-side cleanup.','Reduction to gameplay size necessarily hides detail finer than one output pixel.']};

console.log(`PASS: ${rows.length} Ink packs retain at least ${minimumHeadroom} source pixels per output pixel at 3840x2160/span${minimumSpan}; no aspect or camera changes.`);
