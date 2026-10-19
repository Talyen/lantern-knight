import { rectangle } from '../fixtures/ground';
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyScene } from '../../src/editor/default-scene';
import { artworkFloorLayout } from '../../src/content/floor-layout';
import {
  paintedEnvelopePolicy,
  spritePlacementEnvelope,
} from '../../src/content/placement-envelope';
import { manifestFixture } from '../fixtures/manifest';

function fixture() {
  const d = emptyScene();
  d.floor.width = 20;
  d.floor.depth = 20;
  d.groundInteraction = {
    asset: d.floor.asset,
    frame: 'frame',
    hash: 'a'.repeat(64),
    dimensions: [100, 100],
    destinations: [],
    regions: [
      {
        id: 'bush',
        name: 'Bush',
        depth: { kind: 'anchor', point: { x: 0, z: 0 } },
        mask: [
          {
            outer: rectangle(0.2, 0.2, 0.8, 0.8),
            holes: [rectangle(0.4, 0.4, 0.6, 0.6, true)],
          },
        ],
      },
    ],
  };
  const layout = artworkFloorLayout(20, 20);
  return {
    d,
    at: (u: number, v: number) => layout.world([u, v]),
    inspect: paintedEnvelopePolicy(d),
  };
}
const small = { left: -0.2, right: 0.2, top: 0.5, bottom: 0 };
test('clear feet do not admit a head or wide drawing intersecting painted scenery', () => {
  const { at, inspect } = fixture();
  assert.equal(inspect(at(0.5, 0.85), small), undefined);
  assert.match(inspect(at(0.5, 0.85), { ...small, top: 2 })!, /Bush/);
  assert.match(inspect(at(0.9, 0.5), { ...small, left: -3 })!, /Bush/);
  assert.equal(inspect(at(0.5, 0.5), small), undefined, 'a complete envelope fits in a mask hole');
  assert.match(
    inspect(at(0.5, 0.5), { ...small, top: 3 })!,
    /Bush/,
    'a foot in a hole cannot hide an overlapping head',
  );
});
test('envelopes include scale, mirror, rotation, elevation and the entire spawn jitter interval', () => {
  const { at, inspect } = fixture();
  assert.equal(inspect(at(0.825, 0.7), small), undefined);
  assert.match(inspect(at(0.825, 0.7), small, { scale: 4 })!, /Bush/);
  const side = { left: 0, right: 2, top: 1, bottom: 0 };
  assert.equal(inspect(at(0.82, 0.7), side), undefined);
  assert.match(inspect(at(0.82, 0.7), side, { mirror: true })!, /Bush/);
  assert.match(
    inspect(at(0.9, 0.5), { left: 0, right: 0.2, top: 3, bottom: 0 }, { rotation: Math.PI / 2 })!,
    /Bush/,
  );
  assert.match(inspect(at(0.5, 0.95), small, { y: 4 })!, /Bush/);
  assert.equal(inspect(at(0.5, 0.18), { ...small, top: 0.2 }), undefined);
  assert.match(inspect(at(0.5, 0.18), { ...small, top: 0.2 }, { jitterZ: 3 })!, /Bush/);
  assert.match(inspect(at(0.99, 0.9), small)!, /beyond/);
});
test('collision-only painted undergrowth also reserves visible placement space', () => {
  const { d, at } = fixture();
  d.groundInteraction!.regions = [
    {
      id: 'growth',
      name: 'Undergrowth',
      footprint: [at(0.2, 0.2), at(0.8, 0.2), at(0.8, 0.8), at(0.2, 0.8)],
    },
  ];
  assert.match(paintedEnvelopePolicy(d)(at(0.5, 0.85), { ...small, top: 2 })!, /Undergrowth/);
});
test('unmeasured artwork reserves every registered frame, including non-looping terminal drawings', () => {
  const m = manifestFixture('unmeasured-prop');
  const frame = m.frames[0]!;
  frame.registration = { canvas: [100, 100], density: 10, anchor: [16, 26] };
  frame.trim = [2, 4, 12, 20];
  frame.visualOffsetPx = [5, -3];
  const second = {
    ...frame,
    id: 'terminal',
    trim: [2, 4, 32, 20] as [number, number, number, number],
  };
  m.frames.push(second);
  m.asset.clips = {
    idle: {
      d45: { frames: [frame.id, second.id], durationsMs: [100, 100], loop: false, notifies: [] },
    },
  };
  const expected = {
    left: -0.9,
    right: 2.3,
    top: 2.5,
    bottom: 0.5,
  };
  const actual = spritePlacementEnvelope(m, ['idle']);
  for (const key of ['left', 'right', 'top', 'bottom'] as const)
    assert.ok(Math.abs(actual[key] - expected[key]) < 1e-10, key);
  Object.assign(m.asset.clips, { constructor: m.asset.clips.idle! });
  assert.deepEqual(spritePlacementEnvelope(m, ['constructor']), actual);
  assert.throws(() => spritePlacementEnvelope(m, ['missing']), /registered drawing/);
});
