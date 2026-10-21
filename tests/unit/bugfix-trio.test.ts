import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDirection } from '../../src/content/headings';
import { StorageCodec } from '../../src/platform/storage-codec';
import { parseSettings } from '../../src/platform/settings';
import { content } from '../fixtures/content';
import { mockGlobals } from '../fixtures/globals';
import { FrameScheduler } from '../../src/frame-scheduler';

test('selectDirection ignores invalid previous headings instead of returning them', () => {
  // selectAuthoredDirection already guards with includes(); selectDirection must match.
  const bogus = selectDirection((7 * Math.PI) / 4, 'bogus' as never);
  assert.equal(bogus, 'd315');
  // Valid hysteresis still applies.
  assert.equal(selectDirection(Math.PI / 8 + 0.01, 'd00'), 'd00');
  assert.equal(selectDirection(-Math.PI / 4), 'd315');
  assert.throws(() => selectDirection(NaN));
});

test('StorageCodec.snapshot validates the stored canonical form, not the input', () => {
  // v6 settings lack uiScale and motionBlur; the stored v7 form is larger.
  const v6 = {
    version: 6,
    audio: { master: 1, effects: 1, ambience: 1, muted: false },
    renderScale: 1,
    showDebug: false,
    verticalSpan: 10,
    depthOfField: 0,
    visualEffects: {
      livingLights: true,
      smoke: true,
      rain: true,
      surfaceDepth: true,
      relief: true,
      wind: true,
      atmosphere: true,
      palette: true,
      bloom: true,
    },
  };
  const codec = new StorageCodec(content);
  const snapshot = codec.snapshot('settings', v6);
  // Canonical form carries the upgraded defaults that get stored.
  assert.equal(snapshot.version, 7);
  assert.equal(snapshot.uiScale, 1);
  assert.equal(snapshot.visualEffects.motionBlur, false);
  // Stored bytes are the stringified snapshot, and must fit the slot limit.
  const stored = JSON.stringify(snapshot);
  assert.deepEqual(parseSettings(JSON.parse(stored)), snapshot);
  assert.ok(
    new TextEncoder().encode(stored).byteLength <= 16 * 1024,
    'stored canonical settings fit the slot',
  );
  // Invalid payloads still reject via schema validation.
  assert.throws(() => codec.snapshot('settings', { version: 1, renderScale: 3 }));
});

test('FrameScheduler uses an explicit undefined sentinel for rAF handles', (t) => {
  const win = new EventTarget();
  const doc = new EventTarget();
  let hidden = false;
  Object.assign(doc, { hasFocus: () => true });
  Object.defineProperty(doc, 'hidden', { get: () => hidden });
  let cancels: number[] = [];
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  mockGlobals(t, {
    window: win,
    document: doc,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      // First handle is 0: falsy but valid. The scheduler must not double-schedule.
      const id = next++;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      cancels.push(id);
      pending.delete(id);
    },
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scheduler = new FrameScheduler(
    () => {},
    () => {},
  );
  // One scheduled frame (id 0). A second schedule attempt must not add another.
  assert.equal(pending.size, 1);
  // Disposal must cancel the outstanding handle exactly once, even though it is 0.
  scheduler.dispose();
  assert.deepEqual(cancels, [0]);
  assert.equal(pending.size, 0);

  // Background cadence uses a timer with no rAF handle: disposal must not
  // cancel a frame id it never owned (previously cancelAnimationFrame(0)).
  cancels = [];
  hidden = true;
  const background = new FrameScheduler(
    () => {},
    () => {},
  );
  assert.equal(pending.size, 0);
  background.dispose();
  assert.deepEqual(cancels, []);
});
