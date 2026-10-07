import {readAsset,writeAsset,mkdirAsset} from './assets/io';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { contract,HEADINGS,right } from '../src/core/camera';
import {Vector3} from 'three';
// The inspection proxy retains its original bake precision and registration.
const legacyElevation=35.2643897*Math.PI/180,legacyAzimuth=45*Math.PI/180;
const up=new Vector3().crossVectors(new Vector3(Math.sin(legacyAzimuth)*Math.cos(legacyElevation),Math.sin(legacyElevation),Math.cos(legacyAzimuth)*Math.cos(legacyElevation)),right);
import type {Source} from '../src/assets/schema';
const definitions=[['idle',2,300,true],['walk',4,200,true],['attack_sword_01',4,150,false],['dodge',3,100,false],['cast_lantern_flare',4,150,false],['hit',2,100,false],['death',4,180,false]] as const;
const source:Source={schemaVersion:2,asset:{id:'hero-lantern-knight',type:'character',schemaVersion:2,contentVersion:'0.1.1-proxy',bundle:'hero',status:'diagnostic',designReference:'engineering-placeholder',renderStyle:'diagnostic',provenance:{creator:'Lantern Knight foundation',license:'Project original; editable proxy, not approved art',source:'authoring/knight/rig.blend + tools/diagnostic.ts'},contractId:contract.id,bakeVersion:contract.bakeVersion,canvas:[384,432],density:192,anchor:[192,348],padding:0,colorSpace:'srgb',alpha:'straight',recipe:'blender-proxy-v1 + diagnostic-v1',renderCategory:'cutout',shadow:{radius:0.3,opacity:0.35},collisionFootprint:'hero-circle-v1',occlusion:'vertical-plane-preserved-projection-v1',fallbacks:{run:'walk'},dependencies:[],requiredClips:definitions.map(d=>d[0]),clips:{}},frames:[]};
await mkdirAsset('staging/diagnostic',{recursive:true});
for(const [clip,count,ms,loop] of definitions){source.asset.clips[clip]={} as Source['asset']['clips'][string];for(let d=0;d<8;d++){
  const dir=HEADINGS[d]!,ids:string[]=[];
  for(let f=0;f<count;f++){
    const id=`diag-${clip}-${dir}-${f}`,file=`diagnostic/${id}.png`;ids.push(id);
    const yaw=d*Math.PI/4,anatomicalRight=new Vector3(Math.cos(yaw),0,-Math.sin(yaw)),forward=new Vector3(Math.sin(yaw),0,Math.cos(yaw));
    const px=anatomicalRight.dot(right)*57,py=-anatomicalRight.dot(up)*57,fx=forward.dot(right)*30,fy=-forward.dot(up)*30;
    const phase=f/count*Math.PI*2,leg=clip==='walk'?Math.sin(phase)*23:0,dead=clip==='death'?f*15:0;
    const bodyY=253+dead,armX=192+px,armY=bodyY+py,lanternX=192-px,lanternY=bodyY-py+38;
    const swordAngle=clip==='attack_sword_01'?[-65,-110,35,15][f]!:15;
    const svg=`<svg width="384" height="432" xmlns="http://www.w3.org/2000/svg"><g transform="translate(192,348) scale(1.4) translate(-192,-348)" stroke="#151820" stroke-width="5" stroke-linejoin="round"><path d="M176 289 L${176+leg} 336 L${161+leg} 348 L${184+leg} 348 L186 298 M204 289 L${204-leg} 336 L${198-leg} 348 L${221-leg} 348 L211 295" fill="#514859"/><path d="M176 207 L210 207 L224 291 L160 291 Z" fill="#6c474b"/><path d="M173 216 L148 277 L173 290 M211 216 L239 275 L213 289" fill="#333b49"/><path d="M175 199 L175 167 Q192 150 209 167 L209 199 L196 216 L185 215 Z" fill="#c4a28a"/><path d="M170 177 L175 157 L204 157 L214 181 L203 171 L175 174" fill="#3d333b"/><path d="M192 199 l${fx} ${fy}" stroke="#bda475"/><path d="M180 235 L${armX} ${armY}" stroke="#c4a28a"/><path d="M204 235 L${lanternX} ${lanternY-18}" stroke="#c4a28a"/><g transform="translate(${armX} ${armY}) rotate(${swordAngle})"><path d="M0 8 L0 -77 L8 -90 L16 -77 L16 8 Z" fill="#acd0cc"/><path d="M-8 6 L24 6" stroke="#d8af62"/></g><path d="M${lanternX-11} ${lanternY-17} l22 0 l4 33 l-30 0 Z" fill="#dea64c"/></g><text x="192" y="43" text-anchor="middle" fill="#e6c87d" font-size="14" font-family="monospace">${dir} · DIAGNOSTIC ${f+1}</text><path d="M186 348 h12 M192 342 v12" stroke="#60e3c0" stroke-width="2"/></svg>`;
    await writeAsset(`staging/${file}`,await sharp(Buffer.from(svg)).png().toBuffer());
    source.frames.push({id,path:file,origin:'diagnostic',attachments:{lantern:[192+(lanternX-192)*1.4,348+(lanternY-348)*1.4]}});
  }
  source.asset.clips[clip]![dir]={frames:ids,durationsMs:Array(count).fill(ms),loop,notifies:clip==='walk'?[{id:'step-right',atMs:1,kind:'footstep'},{id:'step-left',atMs:401,kind:'footstep'}]:clip==='attack_sword_01'?[{id:'swing',atMs:167,kind:'whoosh'}]:clip==='cast_lantern_flare'?[{id:'flash',atMs:167,kind:'flash'}]:[]};
}}
for(const [id,dirs] of Object.entries({...source.asset.clips})){source.asset.clips['enemy_'+id]=structuredClone(dirs);source.asset.requiredClips.push('enemy_'+id);}
for(const [id,total] of [['attack_sword_02',32],['attack_sword_03',44]] as const){source.asset.clips[id]=structuredClone(source.asset.clips.attack_sword_01!);for(const c of Object.values(source.asset.clips[id]!)){c.durationsMs=c.durationsMs.map(ms=>ms*(total/36));c.notifies=c.notifies.map(n=>({...n,atMs:n.atMs*(total/36)}));}source.asset.requiredClips.push(id);}
await writeAsset('staging/diagnostic-source.json',JSON.stringify(source,null,2));
await writeAsset('staging/source.json',JSON.stringify(source,null,2));
console.log(`Generated ${source.frames.length} deliberately labeled diagnostic frames; no final art.`);
