import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {hash,exactSource} from './compiler';
import {readAsset} from './assets/io';
import {readLibrarySource} from './assets/sources';
import {parseManifest} from '../src/assets/schema';
import {correctWalkArm} from './walk-arm-correction';
import sharp from 'sharp';

const root='rust_16_frame_drawing_walk_prototype',registration=JSON.parse((await readLibrarySource('timing_and_registration.json',root)).toString()),receipt=JSON.parse((await readLibrarySource('import-receipt.json',root)).toString()),tuning=JSON.parse(await fs.readFile('authoring/walk-tuning.json','utf8'));
const m=parseManifest(JSON.parse(await readAsset('public/generated/ink/ink-hero/manifest.json','utf8')));
for(const [i,record]of registration.frames.entries()){
 const source=await readLibrarySource(record.file,root);assert.equal(hash(source),receipt.files[record.file]);
 const frame=m.frames.find(f=>f.id===`walk-${String(i+1).padStart(2,'0')}`)!;
 assert.deepEqual(await exactSource(frame.source),tuning.frames[i].armCorrection?await correctWalkArm(source,tuning.frames[i].armCorrection):source);
 if(record.kind==='original')assert.deepEqual(source,await readLibrarySource(`frames/walk_right_approx_${String(record.source_index).padStart(2,'0')}.png`,'rust_eight_drawing_walk_prototype'));
}
const skeleton=await readLibrarySource('packs/02_enemies/assets/02_skeleton_halberdier.png');assert.deepEqual(await exactSource('ink/ink-skeleton/rest.png'),skeleton);
for(const id of ['ink-hero','ink-skeleton','ink-scenery','ink-crypt','ink-combat']){
 const manifest=parseManifest(JSON.parse(await readAsset(`public/generated/ink/${id}/manifest.json`,'utf8')));
 for(const frame of manifest.frames){const source=await sharp(await exactSource(frame.source)).ensureAlpha().raw().toBuffer({resolveWithObject:true}),page=manifest.pages.find(p=>p.id===frame.page)!,atlas=await sharp(await readAsset(`public/generated/ink/${id}/${page.path}`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let y=0;y<frame.trim[3];y++)for(let x=0;x<frame.trim[2];x++){const a=((frame.trim[1]+y)*source.info.width+frame.trim[0]+x)*4,b=((frame.rect[1]+y)*atlas.info.width+frame.rect[0]+x)*4;assert.equal(atlas.data[b+3],source.data[a+3]);if(source.data[a+3])assert.deepEqual(atlas.data.subarray(b,b+3),source.data.subarray(a,a+3));}
 }
}
const source=await sharp(await readLibrarySource('frames/walk_right_density16_02_new01.png',root)).ensureAlpha().raw().toBuffer(),corrected=await sharp(await exactSource('ink/ink-hero/walk-02.png')).ensureAlpha().raw().toBuffer();assert.deepEqual(corrected.subarray(0,270*512*4),source.subarray(0,270*512*4));for(let y=270;y<380;y++)assert.deepEqual(corrected.subarray((y*512+245)*4,(y+1)*512*4),source.subarray((y*512+245)*4,(y+1)*512*4));
const flow=JSON.parse(await readAsset('staging/walk-blending/flow.json','utf8'));assert.equal(hash(await readAsset('staging/walk-blending/flow.png')),flow.sha256);assert.equal(hash(await readAsset('staging/ink/ink-hero.json')),flow.stagedSourceHash);
for(const [file,expected]of Object.entries(flow.sourceHashes))assert.equal(hash(await readLibrarySource(file,root)),expected);
for(const [file,expected]of Object.entries(flow.preparedHashes))assert.equal(hash(await exactSource(file)),expected);
console.log('PASS: selected original bytes, corrections, atlas pixels and walk-source bindings verified.');
