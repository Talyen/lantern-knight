import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleAnimation, transitionMix } from '../../src/core/animation-treatment';
import { clipTime } from '../../src/core/animation';
import { remapWalkTime } from '../../src/core/locomotion-timing';

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

test('retiming preserves drawing-relative notifications and markers without changing the source', async () => {
  const { retimeClip } = await import('../../src/core/animation');
  const clip = {
    frames: ['a', 'b'],
    durationsMs: [100, 200],
    loop: false,
    notifies: [{ id: 'step', kind: 'footstep' as const, atMs: 50 }],
    markers: [
      { id: 'contact', atMs: 200 },
      { id: 'end', atMs: 300 },
    ],
  };
  const retimed = retimeClip(clip, [200, 100]);
  assert.deepEqual(
    retimed.notifies.map((n) => n.atMs),
    [100],
  );
  assert.deepEqual(
    retimed.markers?.map((n) => n.atMs),
    [250, 300],
  );
  assert.deepEqual(
    clip.markers.map((n) => n.atMs),
    [200, 300],
  );
});

test('tiny non-looping clips clamp to zero instead of negative time', () => {
  const tiny = { frames: ['a'], durationsMs: [1e-9], loop: false, notifies: [] };
  assert.equal(clipTime(tiny, 10), 0);
  assert.ok(clipTime(tiny, 10) >= 0);
  const from = { frames: ['a', 'b'], durationsMs: [1e-9, 1e-9], loop: false, notifies: [] };
  const to = { frames: ['a', 'b'], durationsMs: [100, 100], loop: false, notifies: [] };
  const remapped = remapWalkTime(from, to, 10);
  assert.ok(Number.isFinite(remapped) && remapped >= 0);
  const sample = sampleAnimation(tiny, 10, 'guarded');
  assert.ok(Number.isFinite(sample.mix) && sample.mix >= 0);
});

test('a fully held transition stays at zero instead of producing NaN', () => {
  assert.equal(transitionMix(0.5, { holdFraction: 1 }), 0);
  assert.equal(transitionMix(1, { holdFraction: 1 }), 0);
  assert.equal(transitionMix(0, { holdFraction: 1 }), 0);
});
