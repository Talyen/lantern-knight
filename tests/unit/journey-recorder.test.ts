import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  installJourneyRecorder,
  readJourneyRecorder,
} from '../../tools/diagnostics/journey-recorder';

test('journey keeps interactive dialogs separate from loading and includes first resumed frames', () => {
  for (const excludeDialogs of [false, true]) {
    let loading = false,
      dialog = true,
      now = 0,
      frame = (_now: number) => {},
      changed = () => {},
      disconnected = false,
      cancelled = false;
    const context = vm.createContext({
      window: {},
      Reflect,
      Math,
      __name: (fn: Function) => fn,
      performance: { now: () => now },
      requestAnimationFrame: (fn: typeof frame) => {
        frame = fn;
        return 1;
      },
      cancelAnimationFrame: () => (cancelled = true),
      document: {
        body: { classList: { contains: () => loading } },
        hidden: false,
        hasFocus: () => true,
        querySelector: () => (dialog ? {} : null),
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
    vm.runInContext(`(${installJourneyRecorder.toString()})(${excludeDialogs})`, context);
    const tick = (value: number) => {
      now = value;
      frame(value);
    };
    tick(10);
    tick(26); // Dialog UI is interactive unless this is an arrival sample.
    loading = true;
    changed();
    tick(426);
    now = 430;
    loading = dialog = false;
    changed();
    tick(446); // The first controllable frame is sixteen ms after loading.
    tick(479); // A real subsequent hitch must survive the classification.
    const result = JSON.parse(
      JSON.stringify(vm.runInContext(`(${readJourneyRecorder.toString()})()`, context)),
    );
    assert.deepEqual(result.frames, excludeDialogs ? [16, 33] : [16, 16, 33]);
    assert.deepEqual(result.loading, excludeDialogs ? [16, 400] : [400]);
    assert.deepEqual(result.frameTimes, excludeDialogs ? [446, 479] : [26, 446, 479]);
    assert.equal(result.foreground, true);
    assert.equal(result.overflow, false);
    assert.equal(cancelled && disconnected, true);
    assert.equal(vm.runInContext(`Reflect.has(window, '__journeyFrames')`, context), false);
  }
});
