import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipPolygon } from '../../src/content/polygon';
import { regionDepth } from '../../src/presentation/ground-occlusion';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import { delayUntilAborted } from '../../src/assets/abort';

test('degenerate clip boundaries intersect to empty instead of returning the subject', () => {
  const subject = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 1 },
    { x: 0, z: 1 },
  ];
  assert.deepEqual(clipPolygon(subject, []), []);
  assert.deepEqual(
    clipPolygon(subject, [
      { x: 0, z: 0 },
      { x: 1, z: 1 },
    ]),
    [],
  );
  assert.deepEqual(
    clipPolygon(subject, [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
    ]),
    [],
  );
  const larger = [
    { x: -1, z: -1 },
    { x: 2, z: -1 },
    { x: 2, z: 2 },
    { x: -1, z: 2 },
  ];
  assert.equal(clipPolygon(subject, larger).length, 4);
});

test('vertical depth edges return a finite depth instead of NaN', () => {
  const layout = artworkFloorLayout(20, 10);
  const a = layout.world([0.5, 0.3]);
  const b = layout.world([0.5, 0.7]);
  const region = {
    id: 'test',
    name: 'Test',
    depth: { kind: 'boundary', points: [a, b] },
  } as Parameters<typeof regionDepth>[0];
  const depth = regionDepth(region, 0.5, layout);
  assert.ok(Number.isFinite(depth));
});

test('abortable delay settles on abort instead of holding the full timeout', async () => {
  const controller = new AbortController();
  const start = Date.now();
  const pending = delayUntilAborted(160, controller.signal);
  setTimeout(() => controller.abort(new Error('superseded')), 10);
  await assert.rejects(pending, /superseded/);
  assert.ok(Date.now() - start < 100);
  const aborted = new AbortController();
  aborted.abort(new Error('already'));
  await assert.rejects(delayUntilAborted(10, aborted.signal), /already/);
  await delayUntilAborted(5, new AbortController().signal);
});
