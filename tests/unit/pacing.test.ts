import test from 'node:test';
import assert from 'node:assert/strict';
import { pacingAcceptance, comparePacing } from '../../tools/diagnostics/pacing-model';
import vm from 'node:vm';
import { installPacingRecorder, readPacingRecorder } from '../../tools/diagnostics/pacing-recorder';

test('the packaged recorder separates loading from first controllable frames and revokes callbacks', () => {
  let paused = true,
    now = 0,
    callback: (now: number) => void = () => {},
    changed = () => {},
    disconnected = false,
    cancelled = false;
  const listeners = new Set<Function>();
  const window = {};
  const context = vm.createContext({
    window,
    Reflect,
    Math,
    KeyboardEvent: class {},
    __name: (fn: Function) => fn,
    performance: { now: () => now },
    requestAnimationFrame: (fn: typeof callback) => {
      callback = fn;
      return 1;
    },
    cancelAnimationFrame: () => {
      cancelled = true;
    },
    document: {
      body: { classList: { contains: () => paused } },
      hidden: false,
      hasFocus: () => true,
      querySelector: () => null,
      addEventListener: (_name: string, fn: Function) => listeners.add(fn),
      removeEventListener: (_name: string, fn: Function) => listeners.delete(fn),
    },
    MutationObserver: class {
      constructor(fn: () => void) {
        changed = fn;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  });
  vm.runInContext(`(${installPacingRecorder.toString()})()`, context);
  const tick = (value: number) => {
    now = value;
    callback(value);
  };
  tick(10);
  tick(1010); // Explicit loading, never an active one-second hitch.
  now = 1015;
  paused = false;
  changed();
  tick(1030);
  tick(1046);
  const result = JSON.parse(
    JSON.stringify(vm.runInContext(`(${readPacingRecorder.toString()})()`, context)),
  );
  assert.deepEqual(result.loading, [1000]);
  assert.deepEqual(result.gaps, [15, 16]);
  assert.equal(result.foreground, true);
  assert.equal(disconnected, true);
  assert.equal(cancelled, true);
  assert.equal(listeners.size, 0);
  tick(2000);
  assert.equal(Reflect.has(window, '__pacing'), false);
});

test('60 Hz acceptance rejects isolated missed frames even when average FPS passes', () => {
  const frames = Array<number>(3600).fill(1000 / 60);
  assert.equal(pacingAcceptance(frames, 60).target, 'met');
  frames[1800] = 25;
  const result = pacingAcceptance(frames, 60);
  assert.ok(result.fps > 59);
  assert.equal(result.missedFrames, 1);
  assert.equal(result.target, 'missed');
  assert.equal(pacingAcceptance(frames, 120).target, 'inconclusive');
});

test('pacing comparisons require equal conditions, accepted inputs and completed gameplay', () => {
  const record = {
    schemaVersion: 6,
    harness: { sha256: 'a'.repeat(64) },
    recordedAt: 'now',
    build: { sourceCommit: 'a', dirty: false, sha256: 'a', inputSha256: 'a'.repeat(64) },
    environment: {
      hardware: 'M5',
      os: 'mac',
      arch: 'arm64',
      runtime: { electron: '44' },
      flags: [],
      gpu: 'Apple M5',
      webgl: '2',
      refreshHz: 60,
      visible: true,
      viewport: [1280, 800],
      buffer: [2560, 1600],
      dpr: 2,
      scenario: 'orchard',
      warmupMs: 0,
      assets: 'a'.repeat(64),
      settings: { scale: 1 },
    },
    fixture: 'fixture',
    durationMs: 60000,
    foreground: true,
    actions: ['lantern', 'dodge'],
    proof: { moved: true, ability: true, dodge: true, combat: true },
    frames: Array(3600).fill(1000 / 60),
  };
  assert.equal(comparePacing(record, record).after.target, 'met');
  for (const patch of [
    { foreground: false },
    { harness: { sha256: 'b'.repeat(64) } },
    { frames: Array(60).fill(1000 / 60) },
    { actions: ['dodge'] },
    { durationMs: 5000 },
    { fixture: 'easier' },
    { proof: { ...record.proof, combat: false } },
    { environment: { ...record.environment, settings: { scale: 0.5 } } },
    { environment: { ...record.environment, buffer: [1280, 800] } },
  ])
    assert.throws(() => comparePacing(record, { ...record, ...patch }));
  for (const patch of [{ visible: false }, { gpu: 'SwiftShader' }, { refreshHz: 0 }]) {
    const bad = { ...record, environment: { ...record.environment, ...patch } };
    assert.throws(() => comparePacing(bad, bad));
  }
});
