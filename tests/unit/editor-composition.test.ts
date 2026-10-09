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
