import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorHistory } from '../../src/editor/model';
import { emptyScene } from '../../src/editor/default-scene';
import { sceneItems } from '../../src/editor/model';
function assembly() {
  const d = emptyScene();
  d.objects = [
    { id: 'support', kind: 'prop', asset: 'ink-scenery', clip: 'offering-table', x: 0, z: 0 },
    {
      id: 'child',
      kind: 'prop',
      asset: 'ink-scenery',
      clip: 'lantern',
      role: 'attachment',
      mount: { to: 'support', offset: [1, 0, 0] },
    },
    { id: 'other', kind: 'prop', asset: 'ink-scenery', clip: 'urn-niche', x: 4, z: 0 },
  ];
  return new EditorHistory(d);
}
it('batch transforms commit once, use a shared pivot, and preserve selected attachments', () => {
  const h = assembly(),
    before = structuredClone(h.document);
  h.transformMany(['support', 'child', 'other'], { rotation: Math.PI / 2, scale: 2 });
  const items = sceneItems(h.document).map((p) => p.placement);
  assert.ok(Math.abs(items[0]!.x - items[1]!.x) < 1e-9);
  assert.ok(Math.abs(items[1]!.z - items[0]!.z - 2) < 1e-9);
  h.undo();
  assert.deepEqual(h.document, before);
  assert.equal(h.canUndo, false);
  h.redo();
  assert.notDeepEqual(h.document, before);
  const valid = structuredClone(h.document);
  assert.throws(() => h.transformMany(['support', 'other'], { scale: 100 }));
  assert.deepEqual(h.document, valid);
});
it('assembly duplication remaps children once and deletion removes dependent children in one undo', () => {
  const h = assembly();
  const ids = h.duplicateMany(['support', 'child']);
  assert.equal(ids.length, 2);
  const parent = h.document.objects.find((p) => p.id === ids[0])!,
    child = h.document.objects.find((p) => p.id === ids[1])!;
  assert.equal(child.mount!.to, parent.id);
  assert.equal(parent.x, 0.5);
  assert.deepEqual(child.mount!.offset, [1, 0, 0]);
  h.undo();
  assert.equal(h.document.objects.length, 3);
  h.redo();
  h.removeMany([parent.id]);
  assert.equal(h.document.objects.length, 3);
  h.undo();
  assert.equal(h.document.objects.length, 5);
});
it('fragments detach external supports while keeping world placement and insert independent identities', () => {
  const h = assembly();
  const fragment = h.fragment(['child']);
  assert.equal(fragment[0]!.mount, undefined);
  assert.equal(fragment[0]!.x, 1);
  const ids = h.insertFragment(fragment);
  assert.notEqual(ids[0], 'child');
  assert.equal(h.document.objects.at(-1)!.x, 1);
});

import { patternPoints } from '../../src/editor/library';
import { parseSceneFragment } from '../../src/content/scene-document';
it('patterns are reproducible, bounded, and follow authored path endpoints', () => {
  const d = emptyScene();
  d.paths = [
    {
      points: [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 4 },
      ],
      width: 1,
    },
  ];
  assert.deepEqual(patternPoints(d, 'path', 3, 1, 2), [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 4 },
  ]);
  d.paths.push({
    points: [
      { x: 10, z: 10 },
      { x: 12, z: 10 },
    ],
    width: 1,
  });
  assert.deepEqual(patternPoints(d, 'path', 2, 1, 2, { pathIndex: 1 }), [
    { x: 10, z: 10 },
    { x: 12, z: 10 },
  ]);
  assert.throws(() => patternPoints(d, 'path', 2, 1, 2, { pathIndex: 3 }));
  const shifted = patternPoints(d, 'scatter', 10, 142, 2, { center: { x: 8, z: -3 } });
  assert.ok(shifted.every((p) => Math.hypot(p.x - 8, p.z + 3) <= 2));
  const points = patternPoints(d, 'scatter', 10, 142, 2);
  assert.deepEqual(points, patternPoints(d, 'scatter', 10, 142, 2));
  assert.ok(points.every((p) => Math.hypot(p.x, p.z) <= 2));
  assert.throws(() => patternPoints(d, 'scatter', 51, 142, 2));
  assert.throws(() =>
    parseSceneFragment({
      version: 1,
      name: 'Broken',
      objects: [
        {
          id: 'child',
          kind: 'prop',
          asset: 'ink-scenery',
          clip: 'lantern',
          role: 'attachment',
          mount: { to: 'missing', offset: [0, 0, 0] },
        },
      ],
    }),
  );
});
