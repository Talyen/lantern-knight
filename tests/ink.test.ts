import { Animator } from '../src/core/animation';
import { Simulation } from '../src/core/simulation';
import { EventHub, type AnimationEvent } from '../src/core/events';
import { PLAYER_ID } from '../src/content/world';
import { AssetRuntime, pageIdentity } from '../src/assets/loader';
import type { Manifest } from '../src/assets/schema';
import { readAsset } from '../tools/assets/io';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Texture, Vector3, MeshBasicMaterial } from 'three';
import { parseManifest, resolveClip } from '../src/assets/schema';
import { ActorSprite, setCutoutOpacity } from '../src/presentation/sprite';
import { makeCamera, drawingBufferSize, trimmedBounds } from '../src/core/camera';
import { areaArtAssets, validateAreaArt, floorUV } from '../src/content/world-art';
import { assetCatalog } from '../src/content/asset-catalog';
import { content } from '../src/content/game-content';
async function manifest(id: string) {
  return parseManifest(JSON.parse(await readAsset('public/' + assetCatalog[id]!, 'utf8')));
}

test('collection importer checks hashes, identical duplicates, unsafe paths and conflicts before writing', () => {
  const script = `import sys,importlib.util,tempfile,pathlib,json,zipfile,hashlib
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
  execFileSync('python3', ['-c', script], { stdio: 'pipe' });
});

test('room visuals validate their dependencies and clips before a transition commits', async () => {
  const area = content.area('court'),
    packs = new Map(
      await Promise.all(
        areaArtAssets(area).map(async (id) => [id, { manifest: await manifest(id) }] as const),
      ),
    );
  validateAreaArt(area, packs);
  packs.delete('ink-cues');
  assert.throws(() => validateAreaArt(area, packs), /missing room art/);
  packs.set('ink-cues', { manifest: await manifest('ink-cues') });
  delete packs.get('ink-scenery')!.manifest.asset.clips.gravestone;
  assert.throws(() => validateAreaArt(area, packs), /required clip unavailable/);
});

test('cutout fades invalidate the opaque shader on transitions, without recompiling unchanged opacity', () => {
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
});

test('real cutouts retain a blended edge layer with shared geometry/texture and coherent fade opacity', async () => {
  const m = await manifest('ink-hero-current'),
    textures = new Map(m.pages.map((p) => [p.id, new Texture()]));
  const s = new ActorSprite('soft-hero', m, textures, resolveClip(m, 'idle', 'd90'));
  s.show(resolveClip(m, 'idle', 'd90').frames[0]!, new Vector3(), makeCamera(16 / 9));
  assert.ok(s.edgeMesh);
  assert.equal(s.edgeMesh.geometry, s.geometry);
  assert.equal(s.edgeMaterial!.map, s.material.map);
  assert.equal(s.edgeMaterial!.depthTest, true);
  assert.equal(s.edgeMaterial!.depthWrite, false);
  assert.equal(s.edgeMaterial!.transparent, true);
  setCutoutOpacity(s.material, 0.38);
  assert.equal(s.edgeMaterial!.opacity, 0.38);
  setCutoutOpacity(s.material, 1);
  assert.equal(s.edgeMaterial!.opacity, 1);
  s.dispose();
});

test('top-down floor image-right maps +X and image-down maps +Z with 4-metre stone repeats', () => {
  assert.deepEqual(floorUV(2, 2), [0.5, -0.5]);
  assert.deepEqual(floorUV(4, 4), [1, -1]);
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
test('valid unsorted clip notifications reach consumers chronologically without losing earlier events', async () => {
  const manifest = JSON.parse(
    await readAsset('public/generated/ink/ink-hero-current/manifest.json', 'utf8'),
  ) as Manifest;
  const clip = manifest.asset.clips.walk!.d90!;
  clip.notifies = [
    { id: 'later', atMs: 150, kind: 'whoosh' },
    { id: 'earlier', atMs: 50, kind: 'dust' },
    { id: 'together', atMs: 150, kind: 'flash' },
  ];
  parseManifest(manifest);
  const animator = new Animator(PLAYER_ID, clip),
    sim = new Simulation(content, 142, content.definitions.initialArea, 1),
    hub = new EventHub(),
    received: string[] = [];
  hub.setGeneration(sim.generation);
  hub.subscribe((e) => {
    if (e.kind === 'animation-notify') received.push(e.notify);
  });
  const base = sim.emit(sim.hero, { kind: 'strike' });
  const publish = () =>
    hub.publish(
      animator.advance(200).map((n) => ({
        ...base,
        key: n.key,
        kind: 'animation-notify',
        notify: n.kind,
        clip: 'walk',
        instance: n.instance,
        timeMs: n.timeMs,
      })),
    );
  publish();
  assert.deepEqual(received, ['dust', 'whoosh', 'flash']);
  animator.start(clip);
  publish();
  assert.deepEqual(received, ['dust', 'whoosh', 'flash', 'dust', 'whoosh', 'flash']);
  assert.deepEqual(
    clip.notifies.map((n) => n.id),
    ['later', 'earlier', 'together'],
  );
  hub.dispose();
});
test('independent manifests isolate frame/page IDs and share compatible page resources with release-once leases', async () => {
  const primary = JSON.parse(
      await readAsset('public/generated/ink/ink-skeleton/manifest.json', 'utf8'),
    ) as Manifest,
    other = structuredClone(primary);
  other.asset.id = 'registration-fixture';
  other.asset.canvas = [1088, 1600];
  other.asset.anchor = [512, 1324];
  other.asset.density = 144;
  other.frames.forEach((f) => {
    f.trim[0] += 32;
    f.trim[1] += 64;
    for (const point of Object.values(f.attachments)) {
      point[0] += 32;
      point[1] += 64;
    }
  });
  let decoded = 0,
    disposed = 0;
  const runtime = new AssetRuntime(
    { first: 'generated/first.json', second: 'generated/second.json' },
    false,
    async (url) => new Response(JSON.stringify(String(url).includes('first') ? primary : other)),
    async () => {
      decoded++;
      return new Texture();
    },
    () => disposed++,
  );
  const [a, b] = await Promise.all([runtime.loadPack('first'), runtime.loadPack('second')]);
  assert.equal(decoded, primary.pages.length);
  assert.equal(a.textures.get('atlas-0'), b.textures.get('atlas-0'));
  const camera = makeCamera(16 / 9),
    foot = new Vector3(1, 0, 2),
    sa = new ActorSprite('a', a.manifest, a.textures, a.manifest.asset.clips.rest!.d45!),
    sb = new ActorSprite('b', b.manifest, b.textures, b.manifest.asset.clips.rest!.d45!);
  sa.animator.advance(200);
  sb.animator.advance(500);
  sa.show(sa.animator.frame, foot, camera);
  sb.show(sb.animator.frame, foot, camera);
  assert.equal(sa.mesh.position.distanceTo(sb.mesh.position), 0);
  assert.notEqual(
    sa.geometry.getAttribute('position').getX(0),
    sb.geometry.getAttribute('position').getX(0),
  );
  sa.dispose();
  sb.dispose();
  a.release();
  a.release();
  assert.equal(disposed, 0);
  b.release();
  assert.equal(disposed, decoded);
  assert.equal(runtime.pool.entries.size, 0);
  const different = structuredClone(primary.pages[0]!);
  different.hash = 'f'.repeat(64);
  assert.notEqual(pageIdentity(different), pageIdentity(primary.pages[0]!));
});

test('all compiled clip/direction frames preserve the same untrimmed foot origin', async () => {
  const m = await manifest('ink-hero-current'),
    asset = m.asset;
  for (const frame of m.frames) {
    const bounds = trimmedBounds(frame.registration ?? asset, frame.trim);
    assert.ok(
      Math.abs(
        bounds.left +
          ((frame.registration ?? asset).anchor[0] - frame.trim[0]) /
            (frame.registration ?? asset).density,
      ) < 1e-7,
    );
    assert.ok(
      Math.abs(
        bounds.top -
          ((frame.registration ?? asset).anchor[1] - frame.trim[1]) /
            (frame.registration ?? asset).density,
      ) < 1e-7,
    );
  }
  for (const dirs of Object.values(m.asset.clips))
    for (const c of Object.values(dirs))
      for (const id of c.frames) assert.ok(m.frames.some((f) => f.id === id));
});
