import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'three';
import { emptyScene } from '../../src/editor/default-scene';
import { parseSceneDocument } from '../../src/content/scene-document';
import { sceneArtFindings } from '../../src/content/scene-art-validation';
import { AnimationBlendShader } from '../../src/presentation/animation-blend-shader';

test('zero-length walls are rejected instead of producing degenerate colliders', () => {
  const doc = emptyScene();
  doc.walls = [{ id: 'w1', from: { x: 1, z: 1 }, to: { x: 1, z: 1 }, height: 2, thickness: 0.3 }];
  assert.throws(() => parseSceneDocument(JSON.parse(JSON.stringify(doc))), /nonempty segment/);
  // A real segment still parses.
  doc.walls = [{ id: 'w1', from: { x: 1, z: 1 }, to: { x: 3, z: 1 }, height: 2, thickness: 0.3 }];
  assert.doesNotThrow(() => parseSceneDocument(JSON.parse(JSON.stringify(doc))));
});

test('self-overlap allowances are flagged instead of silently accepted', () => {
  const props = [
    { id: 'a', x: 0, z: 0 },
    { id: 'b', x: 5, z: 5 },
  ] as never[];
  const region = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  const self = sceneArtFindings({
    props,
    walls: [],
    overlaps: [{ a: 'a', b: 'a', region, reason: 'test' }],
    paths: [],
    graves: [],
  } as never);
  assert.equal(self.length, 1);
  assert.equal(self[0]!.kind, 'unknown-allowance');
  // A distinct pair naming real placements stays silent.
  const valid = sceneArtFindings({
    props,
    walls: [],
    overlaps: [{ a: 'a', b: 'b', region, reason: 'test' }],
    paths: [],
    graves: [],
  } as never);
  assert.deepEqual(valid, []);
});

test('blend updates throw for missing pages instead of storing undefined', () => {
  const shader = new AnimationBlendShader([]);
  const textures = new Map<string, Texture>([['p1', new Texture()]]);
  const manifest = {
    asset: { id: 'test', canvas: [64, 64], density: 1, anchor: [0, 0] },
    pages: [{ id: 'p1', width: 64, height: 64 }],
  } as never;
  const frame = (id: string, page: string) =>
    ({ id, page, trim: [0, 0, 10, 10], rect: [0, 0, 10, 10] }) as never;
  const sample = { from: 'f1', to: 'f2', mix: 0.5, motion: true, guarded: false };
  // Missing runtime texture for the blend target.
  assert.throws(
    () =>
      shader.update(
        sample,
        manifest,
        frame('f1', 'p1'),
        frame('f2', 'missing'),
        textures,
        undefined,
      ),
    /runtime page missing: missing/,
  );
  // Texture exists but the manifest has no such page.
  textures.set('pX', new Texture());
  assert.throws(
    () =>
      shader.update(sample, manifest, frame('f1', 'p1'), frame('f2', 'pX'), textures, undefined),
    /runtime page missing: pX/,
  );
  // Both pages present updates the sampler instead of throwing.
  shader.update(sample, manifest, frame('f1', 'p1'), frame('f2', 'p1'), textures, undefined);
  assert.equal(shader.uniforms.walkNext.value, textures.get('p1'));
  for (const texture of textures.values()) texture.dispose();
});
