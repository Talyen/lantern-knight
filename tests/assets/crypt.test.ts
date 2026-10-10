import { worldVisuals } from '../fixtures/visuals';
import { InkRoom } from '../../src/presentation/ink-room';
import { resolveAuthoredScene } from '../../src/content/world-art';
import { sceneAssets } from '../../src/content/world-visuals';
import { sceneFixture } from '../fixtures/scene';
import { readRegistration } from '../../tools/assets/data';
import type { PackLease } from '../../src/assets/loader';
import { assetFile } from '../../tools/assets/paths';
import { readAsset } from '../../tools/assets/io';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import * as T from 'three';
import { ActorSprite } from '../../src/presentation/sprite';
import { OcclusionFades } from '../../src/presentation/occlusion-fades';
import { findDepthConflicts, validateConstruction } from '../../src/presentation/art-validation';
import { heightAt } from '../../src/content/world';
import { content } from '../fixtures/content';
import { compositionPoint, compositionSpan } from '../../src/content/world-visuals';
import { assetCatalog } from '../../src/content/visuals';
import { parseManifest, resolveClip } from '../../src/assets/schema';
import { makeCamera } from '../../src/core/camera';
import { Simulation } from '../../src/core/simulation';

test('alpha-aware depth gate rejects the original door/arch conflict but ignores transparent margins and separated planes', async () => {
  const area = content.area('upper-landing'),
    art = resolveAuthoredScene(sceneFixture('chapel'));
  assert.ok(
    validateConstruction(area, {
      ...art,
      props: art.props.map((prop) => (prop.mount ? { ...prop, y: 99 } : prop)),
    }).some((error) => error.includes('mount')),
  );
  const packs = new Map<string, PackLease>();
  for (const id of sceneAssets(art)) {
    const manifest = parseManifest(
      JSON.parse(await readAsset('public/' + assetCatalog[id]!, 'utf8')),
    );
    packs.set(id, {
      manifest,
      textures: new Map(manifest.pages.map((page) => [page.id, new T.Texture()])),
      release() {},
    });
  }
  const room = new InkRoom(
    area,
    packs,
    new T.Group(),
    makeCamera(16 / 9),
    undefined,
    readRegistration(),
    art,
  );
  room.build();
  try {
    assert.ok(art.props.every((p) => room.sprites.some((s) => s.id === p.id)));
    assert.equal(heightAt(area, 0, 0), 0);
  } finally {
    room.dispose();
    for (const pack of packs.values())
      for (const texture of pack.textures.values()) texture.dispose();
  }
  const m = parseManifest(
      JSON.parse(await readAsset(`public/${assetCatalog['ink-scenery']}`, 'utf8')),
    ),
    textures = new Map(m.pages.map((p) => [p.id, new T.Texture()])),
    camera = makeCamera(16 / 9);
  const arch = new ActorSprite('arch', m, textures, resolveClip(m, 'arch', 'd45')),
    door = new ActorSprite('door', m, textures, resolveClip(m, 'door-closed', 'd45'));
  try {
    arch.show(arch.animator.frame, new T.Vector3(), camera);
    door.show(door.animator.frame, new T.Vector3(), camera);
    const images = new Map<T.Mesh, { width: number; height: number; data: Uint8Array }>();
    const decoded = new Map<string, { width: number; height: number; data: Uint8Array }>();
    for (const [sprite, file] of [
      [arch, 'arch'],
      [door, 'door-closed'],
    ] as const) {
      const frame = sprite.frameIndex.get(sprite.lastFrame)!,
        page = m.pages.find((page) => page.id === frame.page)!;
      if (!decoded.has(page.id)) {
        const raw = await sharp(assetFile(`public/generated/ink/ink-scenery/${page.path}`))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        decoded.set(page.id, { width: raw.info.width, height: raw.info.height, data: raw.data });
      }
      images.set(sprite.mesh, decoded.get(page.id)!);
      sprite.mesh.userData.artPart = { id: file };
    }
    assert.equal(findDepthConflicts([arch.mesh, door.mesh], images).length, 1);
    door.mesh.position.x = 0.05;
    assert.deepEqual(findDepthConflicts([arch.mesh, door.mesh], images), []);
    door.mesh.position.set(0, 0, 0);
    for (const im of images.values()) im.data.fill(0);
    assert.deepEqual(findDepthConflicts([arch.mesh, door.mesh], images), []);
  } finally {
    arch.dispose();
    door.dispose();
    for (const t of textures.values()) t.dispose();
  }
});
test('assembly fades ease, use interpolated fighters, freeze on pause, and restore more slowly', () => {
  const sim = new Simulation(content, 142, 'upper-landing', 1);
  for (const a of sim.enemies) a.health = 0;
  Object.assign(sim.hero, { x: 0, z: 0, px: 0, pz: 0 });
  const f = new OcclusionFades(),
    camera = makeCamera(16 / 9),
    meshes = [0, 1].map(() => {
      const m = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial());
      m.position.y = 0.3;
      m.quaternion.copy(camera.quaternion);
      f.add(m, 'bay');
      return m;
    });
  try {
    f.update(sim, 1, 1000 / 60);
    const initial = meshes[0]!.material.opacity;
    assert.ok(initial < 1 && initial > 0.8);
    assert.equal(initial, meshes[1]!.material.opacity);
    f.update(sim, 1, 150);
    assert.equal(meshes[0]!.material.opacity, 0.18);
    assert.equal(meshes[0]!.material.depthWrite, false);
    sim.hero.health = 0;
    f.update(sim, 1, 100);
    assert.equal(meshes[0]!.material.opacity, 0.18, 'the held death pose remains visible');
    Object.assign(sim.hero, { x: 50, z: 50, px: 0, pz: 0 });
    f.update(sim, 0, 16);
    assert.equal(meshes[0]!.material.opacity, 0.18, 'interpolated old position still obscures');
    f.update(sim, 1, 0);
    assert.equal(meshes[0]!.material.opacity, 0.18, 'pause freezes opacity');
    f.update(sim, 1, 100);
    assert.ok(meshes[0]!.material.opacity > 0.18 && meshes[0]!.material.opacity < 1);
    f.update(sim, 1, 250);
    assert.equal(meshes[0]!.material.opacity, 1);
    assert.equal(meshes[0]!.material.depthWrite, true);
  } finally {
    for (const m of meshes) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
});

test('authored arrival camera preserves player distance and a continuous follow handoff', () => {
  assert.equal(compositionSpan({ x: 0, z: 7.5 }, 9, worldVisuals['upper-landing']), 11);
  assert.equal(compositionSpan({ x: 0, z: 3 }, 9, worldVisuals['upper-landing']), 9);
  assert.equal(compositionSpan({ x: 0, z: 7.5 }, 13, worldVisuals['upper-landing']), 13);
  assert.equal(compositionSpan({ x: 0, z: 7.5 }, 9, worldVisuals['court']), 9);
  assert.ok(
    Math.abs(compositionSpan({ x: 0, z: 3.00001 }, 9, worldVisuals['upper-landing']) - 9) < 1e-8,
  );
  const before = compositionPoint({ x: 0, z: 3.00001 }, undefined, worldVisuals['upper-landing']),
    after = compositionPoint({ x: 0, z: 2.99999 }, undefined, worldVisuals['upper-landing']);
  assert.ok(Math.abs(before.z - after.z) < 0.0001);
});
