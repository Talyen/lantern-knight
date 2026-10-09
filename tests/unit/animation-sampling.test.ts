import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleAnimation, transitionMix } from '../../src/core/animation-treatment';

test('guarded sampling respects variable holds, looping and terminal death poses', () => {
  const c = { frames: ['a', 'b', 'c'], durationsMs: [100, 50, 150], loop: true, notifies: [] };
  assert.equal(sampleAnimation(c, 50, 'guarded').mix, 0.5);
  assert.equal(sampleAnimation(c, 100.01, 'guarded').from, 'b');
  assert.equal(sampleAnimation(c, 299.99, 'guarded').to, 'a');
  const terminal = sampleAnimation({ ...c, loop: false }, 9999, 'guarded');
  assert.equal(terminal.from, 'c');
  assert.equal(terminal.to, 'c');
});

test('loaded poses stay still before a bounded monotone transition, including loop closure', () => {
  const clip = { frames: ['a', 'b'], durationsMs: [100, 100], loop: true, notifies: [] };
  const transitions = [
    { from: 'a', to: 'b', holdFraction: 0.65, easing: 'ease-in' as const },
    { from: 'b', to: 'a', holdFraction: 0.1, easing: 'smoothstep' as const },
  ];
  assert.equal(sampleAnimation(clip, 64, 'guarded', transitions).mix, 0);
  assert.ok(Math.abs(sampleAnimation(clip, 82.5, 'guarded', transitions).mix - 0.25) < 1e-12);
  assert.equal(sampleAnimation(clip, 82.5, 'original', transitions).mix, 0);
  assert.equal(sampleAnimation(clip, 210, 'guarded', transitions).mix, 0);
  for (const easing of ['linear', 'ease-in', 'ease-out', 'smoothstep'] as const) {
    const samples = Array.from({ length: 101 }, (_, i) =>
      transitionMix(i / 100, { holdFraction: 0.25, easing }),
    );
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 1);
    assert.ok(samples.every((x, i) => i === 0 || x >= samples[i - 1]!));
  }
});
