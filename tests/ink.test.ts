import {readAsset} from '../tools/assets/io';
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Texture,Vector3,MeshBasicMaterial} from 'three';
import {parseManifest,resolveClip} from '../src/assets/schema';
import {ActorSprite,setCutoutOpacity} from '../src/presentation/sprite';
import {makeCamera,drawingBufferSize} from '../src/core/camera';
import {areaArtAssets,validateAreaArt,floorUV} from '../src/content/world-art';
import {content} from '../src/content/world';
async function manifest(id:string){return parseManifest(JSON.parse(await readAsset(`public/generated/ink/${id}/manifest.json`,'utf8')));}


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
 validateAreaArt(area,packs);packs.delete('ink-cues');assert.throws(()=>validateAreaArt(area,packs),/missing room art/);
 packs.set('ink-cues',{manifest:await manifest('ink-cues')});delete packs.get('ink-scenery')!.manifest.asset.clips.gravestone;assert.throws(()=>validateAreaArt(area,packs),/required clip unavailable/);
});

test('cutout fades invalidate the opaque shader on transitions, without recompiling unchanged opacity',()=>{
 const m=new MeshBasicMaterial(),version=m.version;setCutoutOpacity(m,.38);assert.equal(m.transparent,true);assert.equal(m.depthWrite,false);assert.equal(m.version,version+1);
 setCutoutOpacity(m,.38);assert.equal(m.version,version+1);setCutoutOpacity(m,1);assert.equal(m.transparent,false);assert.equal(m.depthWrite,true);assert.equal(m.version,version+2);
 m.dispose();
});

test('real cutouts retain a blended edge layer with shared geometry/texture and coherent fade opacity',async()=>{
 const m=await manifest('ink-hero-current'),textures=new Map(m.pages.map(p=>[p.id,new Texture()]));const s=new ActorSprite('soft-hero',m,textures,resolveClip(m,'idle','d90'));
 s.show(resolveClip(m,'idle','d90').frames[0]!,new Vector3(),makeCamera(16/9));assert.ok(s.edgeMesh);assert.equal(s.edgeMesh.geometry,s.geometry);assert.equal(s.edgeMaterial!.map,s.material.map);
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
