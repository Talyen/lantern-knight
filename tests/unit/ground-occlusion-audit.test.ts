import { test } from 'node:test';
import { crateOcclusionFixture } from '../fixtures/crate-occlusion';
import assert from 'node:assert/strict';
import { parseSceneDocument } from '../../src/content/scene-document';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import {
  auditGroundOcclusion,
  contactDepthRepair,
  maskIntervals,
  depthV,
} from '../../tools/diagnostics/ground-occlusion-audit';

test('detects the orchard crate depth floating below its painted silhouette and supplies a clear probe', () => {
  const { document, crate } = crateOcclusionFixture();
  const finding = auditGroundOcclusion(document).find(
    (f) => f.region === crate.id && f.kind === 'depth-below-silhouette',
  );
  assert.ok(finding);
  assert.ok(finding.gapPixels > 68 && finding.gapPixels < 70);
  assert.ok(finding.witness && finding.witness.hiddenProbeColumns > 0);
});
test('reviewed contact repair follows the lower silhouette and preserves collision and contours', () => {
  const { document, crate } = crateOcclusionFixture();
  const before = structuredClone(crate);
  crate.depth = contactDepthRepair(document, crate.id);
  parseSceneDocument(document);
  const layout = artworkFloorLayout(document.floor.width, document.floor.depth);
  const [w, h] = document.groundInteraction!.dimensions;
  const knots = crate.depth.points.map((p) => layout.uv(p));
  for (let x = Math.ceil(knots[0]![0] * w); x < Math.floor(knots.at(-1)![0] * w); x++) {
    const u = (x + 0.5) / w;
    const bottom = Math.max(...maskIntervals(crate.mask!, u).map((span) => span[1]));
    assert.ok(Math.abs(depthV(crate, u, layout) - bottom) * h <= 2.00001);
  }
  assert.deepEqual({ ...crate, depth: before.depth }, before);
  assert.ok(!auditGroundOcclusion(document).some((f) => f.region === crate.id));
  assert.throws(() => contactDepthRepair(document, crate.id), /requires a depth-below/);
});
test('mask column coverage respects holes, vertical edges and separate islands', () => {
  const outer: [number, number][] = [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.9],
    [0.1, 0.9],
  ];
  const hole: [number, number][] = [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
  ];
  const mask = [{ outer, holes: [hole] }];
  assert.deepEqual(maskIntervals(mask, 0.5), [
    [0.1, 0.3],
    [0.7, 0.9],
  ]);
  assert.deepEqual(maskIntervals(mask, 0.9), []);
  assert.deepEqual(maskIntervals(mask, 0.1), [[0.1, 0.9]]);
  assert.deepEqual(
    maskIntervals(
      [
        { outer: hole, holes: [] },
        { outer: hole.map(([u, v]) => [u, v + 0.5]), holes: [] },
      ],
      0.5,
    ),
    [
      [0.3, 0.7],
      [0.8, 1.2],
    ],
  );
});
test('contact repair refuses compound silhouettes and absent regions', () => {
  const { document, crate } = crateOcclusionFixture();
  crate.mask!.push(structuredClone(crate.mask![0]!));
  assert.throws(() => contactDepthRepair(document, crate.id), /one continuous solid/);
  assert.throws(() => contactDepthRepair(document, 'missing'), /requires a mask/);
});
