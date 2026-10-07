// Vite copies public wholesale. Ship only catalog-selected generated resources;
// retain every historical generation in public for local/in-flight consumers.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {assetCatalog,gameAssetCatalog} from '../src/content/visuals';
import {playgroundCatalog} from '../src/content/effects-playground-assets';
import {parseManifest} from '../src/assets/schema';
import {exactSource,hash} from './compiler';
const dev=process.argv.includes('--dev'),root=dev?'dist-dev':'dist',catalog=dev?{...assetCatalog,...playgroundCatalog}:gameAssetCatalog;
if(!dev)await fs.rm(path.join(root,'calibration-proxy.glb'),{force:true});
if(!dev)await fs.rm(path.join(root,'dev-lighting'),{recursive:true,force:true});
if(!dev)await fs.rm(path.join(root,'dev-effects'),{recursive:true,force:true});
const normals=JSON.parse((await exactSource('lighting/manifest.json',root)).toString());
const normalEntries=Object.fromEntries(Object.entries(normals.entries as Record<string,{file:string;hash:string}>).filter(([key])=>key.split(':')[0]! in catalog));
const normalFiles=new Set(['manifest.json']);
for(const entry of Object.values(normalEntries)){assert.match(entry.file,/^[a-f0-9]{64}\.png$/);assert.equal(hash(await exactSource(`lighting/${entry.file}`,root)),entry.hash);normalFiles.add(entry.file);}
for(const entry of await fs.readdir(path.join(root,'lighting')))if(!normalFiles.has(entry))await fs.unlink(path.join(root,'lighting',entry));
await fs.writeFile(path.join(root,'lighting/manifest.json'),JSON.stringify({...normals,entries:normalEntries},null,2)+'\n');
const keep=new Set<string>(dev?['generated/calibration.json','generated/report.json']:[]);
for(const file of Object.values(catalog)){
 const m=parseManifest(JSON.parse((await exactSource(file,root)).toString()));keep.add(file);
 for(const frame of m.frames){const companion=normals.entries[`${m.asset.id}:${frame.id}`];if(!companion)continue;
  assert.equal(companion.sourceHash,m.pages.find(p=>p.id===frame.page)!.hash,`build lighting source differs: ${m.asset.id}/${frame.id}`);
  assert.deepEqual(companion.rect,frame.rect,`build lighting crop differs: ${m.asset.id}/${frame.id}`);assert.deepEqual(companion.trim,frame.trim,`build lighting registration differs: ${m.asset.id}/${frame.id}`);
 }
 for(const page of m.pages){const filePath=path.posix.join(path.posix.dirname(file),page.path);assert.equal(hash(await exactSource(filePath,root)),page.hash,`build page differs: ${filePath}`);keep.add(filePath);}
}
async function visit(dir:string){for(const entry of await fs.readdir(path.join(root,dir),{withFileTypes:true})){
 const name=path.posix.join(dir,entry.name);
 if(entry.isDirectory()){await visit(name);if(!(await fs.readdir(path.join(root,name))).length)await fs.rmdir(path.join(root,name));}
 else if(!keep.has(name))await fs.unlink(path.join(root,name));
}}
await visit('generated');
console.log(`Selected ${keep.size} generated runtime files; source collection and historical generations stay outside the package.`);
