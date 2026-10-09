import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyScene,
  parseSceneDocument,
  resolveSceneDocument,
  convertLegacySceneDocument,
} from '../src/content/scene-document';
import { worldVisuals, baseWorldVisuals } from '../src/content/world-art';
import { validateSceneDesign } from '../src/content/scene-design';

test('production placements cannot disguise trees, remove collisions or manufacture joins', () => {
  const d = emptyScene('court'),
    before = structuredClone(d);
  for (const change of [
    { id: 'boundary-oak', scale: 0.1 },
    { id: 'boundary-oak', y: 2 },
    { id: 'family-tomb-west', footprint: [0.01, 0.01] },
    { id: 'family-tomb-west', x: 0, zone: 'route' },
    { id: 'family-tomb-west', asset: 'ink-scenery', clip: 'pillar' },
    { id: 'chapel-shell', mirror: true },
  ]) {
    const candidate = structuredClone(d);
    Object.assign(
      candidate.objects.find((p) => p.id === change.id)!,
      change,
    );
    assert.throws(() =>
      resolveSceneDocument(parseSceneDocument(candidate), baseWorldVisuals.court),
    );
  }
  const omitted = resolveSceneDocument(d, baseWorldVisuals.court).props.find(
    (p) => p.id === 'family-tomb-west',
  )!;
  assert.deepEqual(omitted.footprint, [0.95, 2.25]);
  const collision = structuredClone(d),
    tomb = collision.objects.find((p) => p.id === 'family-tomb-west')!;
  Object.assign(
    collision.objects.find((p) => p.id === 'grave-family-kept')!,
    { x: tomb.x, z: tomb.z },
  );
  assert.throws(() => resolveSceneDocument(collision, baseWorldVisuals.court), /intersects/);
  assert.throws(
    () =>
      validateSceneDesign({
        ...worldVisuals.court!,
        walls: [
          { id: 'blocks', from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, height: 1, thickness: 0.3 },
        ],
      }),
    /foundation/,
  );
  assert.deepEqual(d, before);
});
test('production socket offsets are fixed and draft conversion is explicit', () => {
  const d = emptyScene('upper-landing'),
    lamp = d.objects.find((p) => p.id === 'crypt-altar-candles')!;
  lamp.mount!.offset[1] += 1;
  assert.throws(() => resolveSceneDocument(d, baseWorldVisuals['upper-landing']), /socket/);
  const { profile: _, ...study } = emptyScene();
  assert.throws(() => parseSceneDocument({ ...study, version: 3 }), /explicit conversion/);
  assert.deepEqual(convertLegacySceneDocument({ ...study, version: 3 }, 'study'), emptyScene());
});
