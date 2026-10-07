import {readAsset,writeAsset,mkdirAsset} from './assets/io';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {assetCatalog} from '../src/content/visuals';
import type {Manifest} from '../src/assets/schema';
import {normalPixels} from '../src/presentation/lighting-profiles';
const root='public/lighting',check=process.argv.includes('--check'),recipe='alpha-volume-v1',sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const entries:Record<string,unknown>={};
async function output(file:string,bytes:Buffer|string){if(check){if(!Buffer.from(bytes).equals(await readAsset(file)))throw new Error(`lighting derivative stale: ${file}`);}else{await mkdirAsset(path.dirname(file),{recursive:true});await writeAsset(file,bytes);}}
for(const asset of ['ink-hero-current','ink-skeleton','ink-scenery','ink-graveyard-scenery','ink-blackwood-oak','ink-blackwood-woodland']){
 const manifest=JSON.parse(await readAsset(path.join('public',assetCatalog[asset]!),'utf8')) as Manifest;
 for(const frame of manifest.frames){
  const page=manifest.pages.find(p=>p.id===frame.page)!,source=path.join('public',path.dirname(assetCatalog[asset]!),page.path),bytes=await readAsset(source);
  if(sha(bytes)!==page.hash)throw new Error(`lighting source changed: ${source}`);
  const [left,top,width,height]=frame.rect,scale=Math.min(1,192/height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  // Each frame is filtered independently: neighboring atlas frames never bleed into normals.
  const alpha=await sharp(bytes).extract({left,top,width,height}).resize(w,h).extractChannel('alpha').blur(Math.max(.3,Math.min(w,h)*.045)).raw().toBuffer();
  const normals=normalPixels(alpha,w,h,Math.max(6,Math.min(w,h)*.22));
  const png=await sharp(normals,{raw:{width:w,height:h,channels:4}}).png().toBuffer(),key=sha(JSON.stringify({recipe,page:page.hash,rect:frame.rect,trim:frame.trim})),file=`${key}.png`;
  await output(path.join(root,file),png);
  entries[`${asset}:${frame.id}`]={file,hash:sha(png),sourceHash:page.hash,rect:frame.rect,trim:frame.trim,width:w,height:h};
 }
}
await output(path.join(root,'manifest.json'),JSON.stringify({recipe,entries},null,2)+'\n');
console.log(`${check?'Verified':'Prepared'} ${Object.keys(entries).length} independent lighting companions; original art is unchanged.`);
