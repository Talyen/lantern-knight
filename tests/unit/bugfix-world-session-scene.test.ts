import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { GameSession } from '../../src/core/session';
import { parseSceneDocument, type SceneDocument } from '../../src/content/scene-document';
import { emptyScene } from '../../src/editor/default-scene';
import { contentDefinitions } from '../fixtures/content';

const baseArea = (): AreaDefinition =>
  ({
    ...structuredClone(contentDefinitions.areas[0]!),
    id: 'bugfix-area',
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    playableBoundary: undefined,
    activation: undefined,
    entries: [{ id: 'start', x: 0, z: 0 }],
    baselineEntry: 'start',
    spawns: [{ id: 'enemy', actor: 'skeleton', x: 2, z: 2 }],
    exits: [],
    props: [],
    floorColor: 0x334455,
  }) as AreaDefinition;

test('assertArea validates floorColor as a valid 24-bit color integer', () => {
  // Negative floorColor must be rejected
  const negativeColor = baseArea();
  negativeColor.floorColor = -1;
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: negativeColor.id,
        areas: [negativeColor],
      }),
    /invalid floor color/,
  );

  // Floating-point floorColor must be rejected
  const floatColor = baseArea();
  floatColor.floorColor = 123.45;
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: floatColor.id,
        areas: [floatColor],
      }),
    /invalid floor color/,
  );

  // Out of range (> 0xffffff) floorColor must be rejected
  const overflowColor = baseArea();
  overflowColor.floorColor = 0x1000000;
  assert.throws(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: overflowColor.id,
        areas: [overflowColor],
      }),
    /invalid floor color/,
  );

  // Valid 0 and 0xffffff colors pass
  const zeroColor = baseArea();
  zeroColor.floorColor = 0;
  assert.doesNotThrow(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: zeroColor.id,
        areas: [zeroColor],
      }),
  );

  const maxColor = baseArea();
  maxColor.floorColor = 0xffffff;
  assert.doesNotThrow(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: maxColor.id,
        areas: [maxColor],
      }),
  );
});

test('GameSession.fire safely rejects non-string keys with Unknown campfire', () => {
  const session = new GameSession(new ContentRegistry(contentDefinitions));

  assert.throws(() => session.fire(null as unknown as string), /Unknown campfire/);
  assert.throws(() => session.fire(undefined as unknown as string), /Unknown campfire/);
  assert.throws(() => session.fire(123 as unknown as string), /Unknown campfire/);
  assert.throws(() => session.fire({} as unknown as string), /Unknown campfire/);
});

test('SceneDocumentSchema rejects duplicate identities in propOrder', () => {
  const doc = emptyScene();

  const dupPropOrderDoc: SceneDocument = {
    ...doc,
    propOrder: ['prop-tree', 'prop-rock', 'prop-tree'],
  };

  assert.throws(() => parseSceneDocument(dupPropOrderDoc), /Duplicate propOrder identity/);

  // Distinct propOrder passes
  const validPropOrderDoc: SceneDocument = {
    ...doc,
    propOrder: ['prop-tree', 'prop-rock'],
  };
  assert.doesNotThrow(() => parseSceneDocument(validPropOrderDoc));
});
