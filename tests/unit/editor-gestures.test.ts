import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mockGlobals } from '../fixtures/globals';
import { EditorGestures, type GestureLease } from '../../src/editor/gestures';

class Capture extends EventTarget {
  pointers = new Set<number>();
  setPointerCapture(pointer: number) {
    this.pointers.add(pointer);
  }
  hasPointerCapture(pointer: number) {
    return this.pointers.has(pointer);
  }
  releasePointerCapture(pointer: number) {
    this.pointers.delete(pointer);
    this.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: pointer }));
  }
}
function fixture(t: Parameters<typeof mockGlobals>[0]) {
  const window = new EventTarget(),
    document = Object.assign(new EventTarget(), { hidden: false });
  mockGlobals(t, { window, document });
  const gestures = new EditorGestures();
  t.after(() => gestures.dispose());
  return { gestures, window, document, canvas: new Capture() };
}
it('tool replacement releases the old capture and stale completion cannot release its successor', (t) => {
  const { gestures, canvas } = fixture(t);
  let cancellations = 0;
  const old = gestures.begin(canvas, 1, () => cancellations++);
  const next = gestures.begin(canvas, 1, () => cancellations++);
  assert.equal(cancellations, 1);
  assert.equal(old.finish(), false);
  old.cancel();
  assert.equal(next.active, true);
  assert.equal(canvas.hasPointerCapture(1), true);
  assert.equal(next.finish(), true);
  assert.equal(next.finish(), false);
  assert.equal(cancellations, 1, 'capture release during completion is not cancellation');
});
it('document operations revoke pending commits and deny gestures until all operations complete', (t) => {
  const { gestures, canvas } = fixture(t);
  let preview = true;
  const pending = gestures.begin(canvas, 1, () => {
    preview = false;
  });
  const resume = gestures.suspend(),
    nested = gestures.suspend();
  assert.equal(preview, false);
  assert.equal(pending.finish(), false, 'a late pointerup cannot commit into a new scene');
  assert.equal(canvas.pointers.size, 0);
  assert.equal(gestures.begin(canvas, 2, () => {}).active, false);
  resume();
  resume();
  assert.equal(gestures.begin(canvas, 2, () => {}).active, false);
  nested();
  assert.equal(gestures.begin(canvas, 2, () => {}).finish(), true);
});
it('focus loss, hidden documents and capture loss cancel previews once; disposal closes admission', (t) => {
  const { gestures, canvas, window, document } = fixture(t);
  let cancellations = 0;
  for (const end of [
    () => window.dispatchEvent(new Event('blur')),
    () => {
      document.hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    },
    () => canvas.releasePointerCapture(1),
    () => gestures.dispose(),
  ]) {
    const lease = gestures.begin(canvas, 1, () => cancellations++);
    end();
    assert.equal(lease.active, false);
    assert.equal(canvas.pointers.size, 0);
  }
  gestures.dispose();
  assert.equal(cancellations, 4);
  assert.throws(() => gestures.begin(canvas, 1, () => {}), /disposed/);
});
it('a newer gesture admitted by cancellation keeps ownership; disposal prevents reentry', (t) => {
  const { gestures, canvas } = fixture(t);
  let newest: GestureLease | undefined;
  gestures.begin(canvas, 1, () => {
    newest = gestures.begin(canvas, 3, () => {});
  });
  const superseded = gestures.begin(canvas, 2, () => {});
  assert.equal(superseded.active, false);
  assert.equal(newest?.active, true);
  assert.deepEqual([...canvas.pointers], [3]);
  newest?.finish();
  gestures.begin(canvas, 1, () => {
    assert.throws(() => gestures.begin(canvas, 2, () => {}), /disposed/);
  });
  gestures.dispose();
});
