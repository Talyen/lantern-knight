import { sceneFixture } from './fixtures/scene';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyScene,
  parseSceneDocument,
  resolveSceneDocument,
  convertLegacySceneDocument,
} from '../src/content/scene-document';
import { baseWorldVisuals } from '../src/content/world-art';
import { validateSceneDesign, sceneCompositionFindings } from '../src/content/scene-design';

test('production placements cannot disguise trees, remove collisions or manufacture joins', () => {
  const d = sceneFixture('graveyard'),
    before = structuredClone(d);
  for (const change of [
    { id: 'boundary-oak', scale: 0.1 },
    { id: 'boundary-oak', y: 2 },
    { id: 'family-tomb-west', footprint: [0.01, 0.01] },
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
        ...resolveSceneDocument(sceneFixture('graveyard'), baseWorldVisuals.court),
        walls: [
          { id: 'blocks', from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, height: 1, thickness: 0.3 },
        ],
      }),
    /foundation/,
  );
  assert.deepEqual(d, before);
});
test('production socket offsets are fixed and draft conversion is explicit', () => {
  const d = sceneFixture('chapel'),
    lamp = d.objects.find((p) => p.id === 'crypt-altar-candles')!;
  lamp.mount!.offset[1] += 1;
  assert.throws(() => resolveSceneDocument(d, baseWorldVisuals['upper-landing']), /socket/);
  const { profile: _, ...study } = emptyScene();
  assert.throws(() => parseSceneDocument({ ...study, version: 3 }), /explicit conversion/);
  assert.deepEqual(convertLegacySceneDocument({ ...study, version: 3 }, 'study'), emptyScene());
});

test('prototype placement and cluster density are advisory while registered footprints remain authoritative', () => {
  const d = sceneFixture('graveyard');
  d.objects.find((p) => p.id === 'family-tomb-west')!.x = 0;
  for (let i = 0; i < 10; i++)
    d.objects.push({
      id: 'marker-' + i,
      kind: 'prop',
      asset: 'ink-tended-marker',
      clip: 'marker',
      x: -5,
      z: -4.4 + i * 0.6,
      zone: 'west-burials',
    });
  const art = resolveSceneDocument(parseSceneDocument(d), baseWorldVisuals.court);
  assert.ok(sceneCompositionFindings(art).some((note) => note.includes('clear zone')));
  assert.ok(sceneCompositionFindings(art).some((note) => note.includes('dense cluster')));
  assert.deepEqual(art.props.find((p) => p.id === 'family-tomb-west')!.footprint, [0.95, 2.25]);
});
