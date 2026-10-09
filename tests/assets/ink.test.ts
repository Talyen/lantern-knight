import { worldVisuals } from '../fixtures/visuals';
import { readAsset } from '../../tools/assets/io';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Texture, MeshBasicMaterial } from 'three';
import { parseManifest, resolveClip } from '../../src/assets/schema';
import { ActorSprite, setCutoutOpacity } from '../../src/presentation/sprite';
import { drawingBufferSize } from '../../src/core/camera';
import { sceneAssets, validateAreaArt } from '../../src/content/world-art';
import { assetCatalog } from '../../src/content/asset-catalog';
import { content } from '../fixtures/content';
async function manifest(id: string) {
  return parseManifest(JSON.parse(await readAsset('public/' + assetCatalog[id]!, 'utf8')));
}

test('collection importer checks hashes, identical duplicates, unsafe paths and conflicts before writing', () => {
  const script = `import sys,importlib.util,tempfile,pathlib,json,zipfile,hashlib
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('importer','tools/assets/import-ink.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
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
  execFileSync('python3', ['-c', script], { stdio: 'pipe' });
});

test('room visuals validate their dependencies and clips before a transition commits', async () => {
  const area = content.area('court'),
    packs = new Map(
      await Promise.all(
        sceneAssets(worldVisuals[area.id]!).map(
          async (id) => [id, { manifest: await manifest(id) }] as const,
        ),
      ),
    );
  validateAreaArt(area, packs, worldVisuals[area.id]);
  packs.delete('ink-stage-earth');
  assert.throws(() => validateAreaArt(area, packs, worldVisuals[area.id]), /missing room art/);
  packs.set('ink-stage-earth', { manifest: await manifest('ink-stage-earth') });
  delete packs.get('ink-blackwood-oak')!.manifest.asset.clips.oak;
  assert.throws(
    () => validateAreaArt(area, packs, worldVisuals[area.id]),
    /required clip unavailable/,
  );
});

test('cutout fades invalidate the opaque shader on transitions, without recompiling unchanged opacity', async () => {
  const m = new MeshBasicMaterial(),
    version = m.version;
  setCutoutOpacity(m, 0.38);
  assert.equal(m.transparent, true);
  assert.equal(m.depthWrite, false);
  assert.equal(m.version, version + 1);
  setCutoutOpacity(m, 0.38);
  assert.equal(m.version, version + 1);
  setCutoutOpacity(m, 1);
  assert.equal(m.transparent, false);
  assert.equal(m.depthWrite, true);
  assert.equal(m.version, version + 2);
  m.dispose();
  const manifest = parseManifest(
    JSON.parse(await readAsset('public/generated/ink/ink-hero-current/manifest.json', 'utf8')),
  );
  const textures = new Map(manifest.pages.map((page) => [page.id, new Texture()]));
  const sprite = new ActorSprite('edges', manifest, textures, resolveClip(manifest, 'idle', 'd90'));
  assert.equal(sprite.edgeMesh!.geometry, sprite.geometry);
  assert.equal(sprite.edgeMaterial!.map, sprite.material.map);
  assert.equal(sprite.edgeMaterial!.depthWrite, false);
  for (const opacity of [0.38, 1]) {
    setCutoutOpacity(sprite.material, opacity);
    assert.equal(sprite.edgeMaterial!.opacity, opacity);
  }
  sprite.dispose();
  textures.forEach((texture) => texture.dispose());
});

test('Retina windows render physical pixels within the selected 4K budget, with explicit quality scaling', () => {
  assert.deepEqual(drawingBufferSize(1280, 640, 2), { width: 2560, height: 1280, pixelRatio: 2 });
  assert.deepEqual(drawingBufferSize(2560, 1440, 2), {
    width: 3840,
    height: 2160,
    pixelRatio: 1.5,
  });
  assert.deepEqual(drawingBufferSize(1280, 640, 1), { width: 1280, height: 640, pixelRatio: 1 });
  assert.deepEqual(drawingBufferSize(3840, 2160, 1), { width: 3840, height: 2160, pixelRatio: 1 });
  assert.deepEqual(drawingBufferSize(1920, 1080, 2), { width: 3840, height: 2160, pixelRatio: 2 });
  assert.deepEqual(drawingBufferSize(3840, 2160, 2), { width: 3840, height: 2160, pixelRatio: 1 });
  assert.deepEqual(drawingBufferSize(2560, 1440, 2, 0.5), {
    width: 1920,
    height: 1080,
    pixelRatio: 1.5,
  });
  assert.deepEqual(drawingBufferSize(1280, 640, 2, 0.5), {
    width: 1280,
    height: 640,
    pixelRatio: 2,
  });
  assert.throws(() => drawingBufferSize(0, 640, 2));
  assert.throws(() => drawingBufferSize(1280, 640, NaN));
});
