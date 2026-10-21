import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSceneDocument,
  parseSceneFragment,
  fragmentBytesLimit,
  type SceneDocument,
} from '../../src/content/scene-document';
import { emptyScene } from '../../src/editor/default-scene';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';

const baseArea = (): AreaDefinition =>
  ({
    ...structuredClone(contentDefinitions.areas[0]!),
    id: 'bugfix-trio-1021',
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    playableBoundary: undefined,
    activation: undefined,
    entries: [{ id: 'start', x: -3, z: 0 }],
    baselineEntry: 'start',
    spawns: [{ id: 'enemy', actor: 'skeleton', x: 3, z: 0 }],
    exits: [],
    props: [],
  }) as AreaDefinition;

test('resolveSceneDocument stably sorts unordered props without NaN comparisons', () => {
  const scene: SceneDocument = {
    ...emptyScene(),
    propOrder: ['prop-c'], // only prop-c is ordered; prop-d, prop-b, prop-a are unordered
    objects: [
      { id: 'prop-d', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 1, z: 1 },
      { id: 'prop-b', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 2, z: 2 },
      { id: 'prop-c', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 3, z: 3 },
      { id: 'prop-a', kind: 'prop', asset: 'ink-scenery', clip: 'lantern', x: 4, z: 4 },
    ],
  };

  const resolved = resolveSceneDocument(scene);
  const ids = resolved.props.map((p) => p.id);
  // prop-c is at index 0 (propOrder), then remaining unordered props preserve document order stably
  assert.deepEqual(ids, ['prop-c', 'prop-d', 'prop-b', 'prop-a']);

  // Completely empty propOrder preserves original document order stably without NaN comparisons
  const sceneEmptyOrder: SceneDocument = {
    ...scene,
    propOrder: [],
  };
  const resolvedEmpty = resolveSceneDocument(sceneEmptyOrder);
  assert.deepEqual(
    resolvedEmpty.props.map((p) => p.id),
    ['prop-d', 'prop-b', 'prop-c', 'prop-a'],
  );
});

test('assertArea rejects unknown surface kind and invalid surface axis', () => {
  // Unknown surface kind must fail
  const badKind = baseArea();
  badKind.surface = {
    kind: 'cliff' as never,
    axis: 'x',
    start: -2,
    end: 2,
    startHeight: 0,
    endHeight: 1,
  };
  assert.throws(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: badKind.id, areas: [badKind] }),
    /invalid surface bugfix-trio-1021/,
  );

  // Invalid axis (e.g. 'y') must fail
  const badAxis = baseArea();
  badAxis.surface = {
    kind: 'ramp',
    axis: 'y' as never,
    start: -2,
    end: 2,
    startHeight: 0,
    endHeight: 1,
  };
  assert.throws(
    () => new ContentRegistry({ ...contentDefinitions, initialArea: badAxis.id, areas: [badAxis] }),
    /invalid surface axis bugfix-trio-1021/,
  );

  // Valid ramp with axis 'x' admits
  const validRamp = baseArea();
  validRamp.surface = {
    kind: 'ramp',
    axis: 'x',
    start: -2,
    end: 2,
    startHeight: 0,
    endHeight: 1,
  };
  assert.doesNotThrow(
    () =>
      new ContentRegistry({
        ...contentDefinitions,
        initialArea: validRamp.id,
        areas: [validRamp],
      }),
  );
});

test('parseSceneFragment enforces the 64 KiB authored-file limit', () => {
  const baseObject = {
    id: 'prop-1',
    kind: 'prop',
    asset: 'ink-scenery',
    clip: 'lantern',
    x: 0,
    z: 0,
  };

  // Valid small fragment parses successfully
  const valid = {
    version: 1,
    name: 'Small fragment',
    objects: [baseObject],
  };
  const parsed = parseSceneFragment(valid);
  assert.equal(parsed.name, 'Small fragment');
  assert.equal(parsed.objects.length, 1);

  // Large fragment exceeding 64 KiB must be rejected
  const manyObjects = Array.from({ length: 450 }, (_, i) => ({
    id: `prop-${i}`,
    kind: 'prop' as const,
    asset: 'ink-scenery',
    clip: 'lantern',
    x: (i % 20) - 10,
    z: Math.floor(i / 20) - 10,
    label: 'A'.repeat(70),
    purpose: 'B'.repeat(80),
  }));
  const oversized = {
    version: 1,
    name: 'Oversized fragment',
    objects: manyObjects,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(oversized)).length;
  assert.ok(bytes > fragmentBytesLimit, `Expected > ${fragmentBytesLimit} bytes, got ${bytes}`);

  assert.throws(
    () => parseSceneFragment(oversized),
    /Fragment exceeds the 64 KiB authored-file limit/,
  );
});
