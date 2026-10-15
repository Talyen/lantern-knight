import { cameraContract } from '../../src/assets/camera-contract';
import { worldVisuals } from '../fixtures/visuals';
import { InkRoom } from '../../src/presentation/ink-room';
import { resolveAuthoredScene } from '../../src/content/world-art';
import { sceneAssets } from '../../src/content/world-visuals';
import { sceneFixture } from '../fixtures/scene';
import { readRegistration } from '../../tools/assets/data';
import type { PackLease } from '../../src/assets/loader';
import { readAsset } from '../../tools/assets/io';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ActorSprite } from '../../src/presentation/sprite';
import { coplanarArtConflicts } from '../../src/presentation/carrier-validation';
import { sceneArtFindings } from '../../src/content/scene-art-validation';
import { heightAt } from '../../src/content/world';
import { content } from '../fixtures/content';
import { compositionPoint, compositionSpan } from '../../src/content/world-visuals';
import { assetCatalog } from '../../src/content/visuals';
import { parseManifest, resolveClip } from '../../src/assets/schema';
import { makeCamera } from '../../src/presentation/camera';

test('alpha-aware depth gate rejects the original door/arch conflict but ignores transparent margins and separated planes', async () => {
  const area = content.area('upper-landing'),
    art = resolveAuthoredScene(sceneFixture('chapel'));
  assert.ok(
    sceneArtFindings({
      ...art,
      props: art.props.map((prop) => (prop.mount ? { ...prop, y: 99 } : prop)),
    }).some((finding) => finding.message.includes('mount')),
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
    const masks = structuredClone(readRegistration().coverage.masks);
    assert.equal(coplanarArtConflicts([arch, door], masks).length, 1);
    door.mesh.position.x = 0.05;
    assert.deepEqual(coplanarArtConflicts([arch, door], masks), []);
    door.mesh.position.set(0, 0, 0);
    for (const mask of Object.values(masks)) mask.alpha.fill(0);
    assert.deepEqual(coplanarArtConflicts([arch, door], masks), []);
  } finally {
    arch.dispose();
    door.dispose();
    for (const t of textures.values()) t.dispose();
  }
});
test('authored arrival camera preserves player distance and a continuous follow handoff', () => {
  const span = cameraContract.verticalSpan;
  assert.equal(compositionSpan({ x: 0, z: 7.5 }, span, worldVisuals['upper-landing']), 11);
  assert.equal(compositionSpan({ x: 0, z: 3 }, span, worldVisuals['upper-landing']), span);
  assert.equal(compositionSpan({ x: 0, z: 7.5 }, 9, worldVisuals['upper-landing']), 9);
  assert.equal(compositionSpan({ x: 0, z: 7.5 }, 13, worldVisuals['upper-landing']), 13);
  assert.equal(compositionSpan({ x: 0, z: 7.5 }, 9, worldVisuals['court']), 9);
  assert.ok(
    Math.abs(compositionSpan({ x: 0, z: 3.00001 }, span, worldVisuals['upper-landing']) - span) <
      1e-8,
  );
  const before = compositionPoint({ x: 0, z: 3.00001 }, undefined, worldVisuals['upper-landing']),
    after = compositionPoint({ x: 0, z: 2.99999 }, undefined, worldVisuals['upper-landing']);
  assert.ok(Math.abs(before.z - after.z) < 0.0001);
});
