import test from 'node:test';
import assert from 'node:assert/strict';
import { scenePreviewSchema, previewHero } from '../../src/sandbox/preview';
import { sandboxContent } from '../../src/content/sandbox-world';
import { ContentRegistry, heightAt, type ContentDefinitions } from '../../src/content/world';
import { isSupportedPosition } from '../../src/content/collision';
import { defaultLook } from '../../src/presentation/lighting-profiles';

test('preview reload reconciles blocked or moved positions without accepting corrupt state', () => {
  const state = {
    version: 1,
    scene: 'outdoor-fixture',
    hero: { x: 999, z: 999, yaw: 0.8 },
    span: 11,
    scale: 1,
    paused: true,
    mode: 'lighting',
    look: { ...defaultLook, rig: 'silver', strength: 0.8 },
  };
  const restored = scenePreviewSchema.parse(state);
  assert.ok(restored);
  const hero = previewHero(restored, sandboxContent);
  assert.ok(isSupportedPosition(sandboxContent.area('outdoor-fixture'), hero, 0.3));
  assert.equal(hero.px, hero.x);
  assert.equal(hero.pz, hero.z);
  assert.equal(hero.py, heightAt(sandboxContent.area('outdoor-fixture'), hero.x, hero.z));
  assert.equal(hero.yaw, 0.8);
  assert.equal(restored.paused, true);
  assert.equal(restored.look.rig, 'silver');
  assert.equal(restored.span, 11);
  const legacyLook = { ...state.look } as Partial<typeof state.look>;
  delete legacyLook.paintedValues;
  delete legacyLook.paintedFinish;
  delete legacyLook.groundBounce;
  delete legacyLook.tightContacts;
  const legacy = scenePreviewSchema.parse({ ...state, look: legacyLook });
  assert.equal(legacy.look.paintedValues, true);
  assert.equal(legacy.look.paintedFinish, true);
  assert.equal(legacy.look.groundBounce, true);
  assert.equal(legacy.look.tightContacts, true);
  const comparison = scenePreviewSchema.parse({
    ...state,
    look: {
      ...state.look,
      paintedValues: false,
      paintedFinish: false,
      groundBounce: true,
      tightContacts: true,
    },
  });
  assert.equal(comparison.look.groundBounce, true);
  assert.equal(comparison.look.tightContacts, true);
  assert.equal(comparison.look.paintedValues, false);
  assert.equal(comparison.look.paintedFinish, false);
  assert.throws(() => previewHero({ ...restored, scene: 'missing' }, sandboxContent));
  for (const bad of [
    { ...state, scale: 0 },
    { ...state, hero: { x: null, z: 0, yaw: 0 } },
    { ...state, look: { ...state.look, strength: Infinity } },
  ])
    assert.equal(scenePreviewSchema.safeParse(bad).success, false);

  const definitions: ContentDefinitions = structuredClone(sandboxContent.definitions);
  const area = definitions.areas.find((area) => area.id === state.scene)!;
  Object.assign(area, {
    bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
    playableBoundary: undefined,
    surface: { kind: 'flat', height: 2 },
    props: [],
    spawns: [],
    exits: [],
    baselineEntry: 'start',
    entries: [{ id: 'start', x: 0, z: 0 }],
  });
  definitions.actors.find((actor) => actor.id === definitions.player)!.radius = 0.6;
  const larger = new ContentRegistry({ ...definitions, initialArea: area.id, areas: [area] });
  const nearEdge = previewHero({ ...restored, hero: { x: 4.7, z: 0, yaw: 0.8 } }, larger);
  assert.ok(isSupportedPosition(area, nearEdge, 0.6));
  area.props = [{ id: 'trap', kind: 'pillar', x: 4.1, z: 0, radius: 0.7, height: 1 }];
  const trapped = new ContentRegistry({ ...definitions, initialArea: area.id, areas: [area] });
  const recovered = previewHero({ ...restored, hero: { x: 4.7, z: 0, yaw: 0.8 } }, trapped);
  assert.ok(isSupportedPosition(area, recovered, 0.6));
  assert.equal(recovered.x, 0);
  assert.equal(recovered.y, 2);
});
