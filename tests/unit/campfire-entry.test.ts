import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCampfireEntry, type AreaDefinition } from '../../src/content/world';

const area = {
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  surface: { kind: 'flat', height: 0 },
  props: [],
} as unknown as AreaDefinition;

test('campfire entries admit the inclusive 1.6 reach and reject anything beyond it', () => {
  const fire = { x: 0, z: 0, safeRadius: 2.6 };
  assert.equal(isValidCampfireEntry(area, fire, { x: 1.6, z: 0 }), true, 'exactly 1.6 is admitted');
  assert.equal(isValidCampfireEntry(area, fire, { x: 1.61, z: 0 }), false);
  // The safe radius still bounds an entry even below the shared cap.
  assert.equal(isValidCampfireEntry(area, { ...fire, safeRadius: 1.2 }, { x: 1.2, z: 0 }), false);
  assert.equal(isValidCampfireEntry(area, { ...fire, safeRadius: 1.2 }, { x: 1.1, z: 0 }), true);
});
