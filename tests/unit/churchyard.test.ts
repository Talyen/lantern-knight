import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportedPosition, isSupportedPosition, heightAt } from '../../src/content/world';
import { content, contentDefinitions } from '../fixtures/content';
import { content as visualContent } from '../fixtures/visuals';
import { Simulation } from '../../src/core/simulation';
import { GameSession } from '../../src/core/session';

import { worldVisuals } from '../fixtures/visuals';
import { compositionPoint, compositionHeight } from '../../src/content/world-art';
const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: -1 } };
test('encounters remain dormant until activation and damage wakes their peers', () => {
  assert.deepEqual(
    contentDefinitions.areas.map((a) => a.id),
    ['court', 'upper-landing'],
  );
  for (const [area, count] of [
    ['court', 1],
    ['upper-landing', 2],
  ] as const) {
    const s = new Simulation(content, 142, area, 1);
    assert.equal(s.enemies.length, count);
    assert.equal(s.engaged, false);
    const before = s.enemies.map((a) => [a.x, a.z, a.health]);
    for (let i = 0; i < 240; i++) s.step(still);
    assert.deepEqual(
      s.enemies.map((a) => [a.x, a.z, a.health]),
      before,
    );
    assert.equal(s.hero.health, 100);
    for (const spawn of s.areaDefinition.spawns) {
      assert.equal(spawn.actor, 'skeleton');
      assert.equal(spawn.jitterZ, undefined);
      for (let i = 0; i <= 20; i++) {
        const p = {
          x: spawn.x * (1 - i / 20),
          z: spawn.z + (((area === 'court' ? 5.8 : 7.5) - spawn.z) * i) / 20,
        };
        assert.ok(isSupportedPosition(s.areaDefinition, p, 0.3));
      }
    }
  }
  const s = new Simulation(content, 142, content.definitions.initialArea, 1);
  s.hero.z = 1.2;
  s.step(still);
  assert.ok(s.engaged);
  assert.notEqual(s.enemies[0]!.state, 'idle');
  const group = new Simulation(content, 142, 'upper-landing', 1);
  group.damage(group.hero, group.enemies[0]!, 1);
  assert.ok(group.engaged);
  group.step(still);
  assert.equal(group.enemies[1]!.state, 'walk');
});
test('activation survives load/revisit and resets on death; backward passage allows retreat', () => {
  const session = new GameSession(content);
  assert.throws(() => session.prepareTransition('landing'), /unavailable/);
  session.sim.damage(session.sim.hero, session.sim.enemies[0]!, 100);
  session.step(still);
  session.commitTransition(session.prepareTransition('landing'));
  assert.equal(session.sim.engaged, false);
  session.sim.damage(session.sim.hero, session.sim.enemies[0]!, 1);
  session.commitTransition(session.prepareTransition('court'));
  assert.ok(session.sim.cleared);
  session.commitTransition(session.prepareTransition('landing'));
  assert.ok(session.sim.engaged);
  assert.equal(session.sim.enemies[0]!.health, 49);
  const save = session.captureSave(),
    restored = new GameSession(content);
  restored.restoreSave(save);
  assert.ok(restored.sim.engaged);
  restored.sim.damage(restored.sim.enemies[0]!, restored.sim.hero, 1000);
  restored.sim.hero.age = 90;
  restored.step(still);
  assert.equal(restored.sim.engaged, false);
  assert.deepEqual(
    restored.sim.enemies.map((a) => a.health),
    [50, 50],
  );
  restored.sim.hero.z = 8.3;
  assert.equal(restored.step(still).transition, 'court');
});
test('authored box footprints block bodies at edges and corners without escaping bounds', () => {
  const area = content.area('court'),
    p = area.props.find((p) => p.id === 'family-tomb-west')!;
  for (const point of [
    { x: p.x, z: p.z },
    { x: p.x + 0.9, z: p.z + 0.3 },
    { x: -100, z: 100 },
  ]) {
    const q = supportedPosition(area, point, 0.3);
    assert.ok(isSupportedPosition(area, q, 0.3));
    assert.ok(q.x >= area.bounds.minX + 0.3 && q.z <= area.bounds.maxZ - 0.3);
  }
  for (const a of content.areas.values())
    for (const entry of a.entries) assert.ok(isSupportedPosition(a, entry, 0.3));
  for (const area of visualContent.areas.values())
    for (const collider of area.props) {
      const art = worldVisuals[area.id]!,
        sprite = art.props.find((p) => p.id === collider.id),
        wall = art.walls.find((w) => w.id === collider.id);
      if (collider.shape === 'polygon') {
        assert.ok(collider.polygon!.length >= 3);
        continue;
      }
      assert.ok(sprite || wall);
      if (sprite) assert.deepEqual(collider.size, sprite.footprint);
      else {
        assert.equal(collider.x, (wall!.from.x + wall!.to.x) / 2);
        assert.equal(collider.z, (wall!.from.z + wall!.to.z) / 2);
      }
    }
  const graveyard = content.area('court'),
    chapel = content.area('upper-landing');
  assert.equal(heightAt(graveyard, 4, 0), 0);
  assert.equal(heightAt(graveyard, 0, -5.4), 0);
  assert.equal(heightAt(graveyard, 0, -5.95), 0);
  assert.equal(heightAt(chapel, 0, 0), 0);
  assert.equal(graveyard.exits[0]!.destination, chapel.id);
  assert.equal(chapel.exits[0]!.destination, graveyard.id);
  assert.equal(chapel.exits[0]!.requiresClear, false);
});

test('a clear fixture arena supports the complete dodge distance', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const sim = new Simulation(content, 142, content.definitions.initialArea, 1);
    sim.enemies.forEach((a) => (a.health = 0));
    Object.assign(sim.hero, { x: 0, z: 0.25, yaw, aim: yaw });
    sim.step({
      move: { x: Math.sin(yaw), z: Math.cos(yaw) },
      aim: { x: Math.sin(yaw) * 3, z: 0.25 + Math.cos(yaw) * 3 },
      dodge: true,
    });
    while (sim.hero.state === 'dodge') sim.step(still);
    assert.ok(
      Math.abs(Math.hypot(sim.hero.x, sim.hero.z - 0.25) - 2.1) < 0.03,
      'A clear arena must preserve directed dodge distance',
    );
  }
});

test('narrow authored framing keeps the hero and full silhouette inside the viewport', () => {
  const elevation = Math.atan(1 / Math.sqrt(2)),
    halfHeight = 4.5;
  for (const halfWidth of [(halfHeight * 9) / 16, (halfHeight * 16) / 9, (halfHeight * 21) / 9])
    for (const hero of visualContent.area('court').entries) {
      const target = compositionPoint('court', hero, { halfWidth, halfHeight }, worldVisuals.court),
        dx = hero.x - target.x,
        dz = hero.z - target.z,
        x = (dx - dz) / Math.sqrt(2),
        root =
          (-(dx + dz) * Math.sin(elevation)) / Math.sqrt(2) -
          compositionHeight('court', hero, worldVisuals.court) * Math.cos(elevation);
      assert.ok(Math.abs(x) < halfWidth - 0.7);
      assert.ok(root > -halfHeight + 0.5);
      assert.ok(root + 1.8 * Math.cos(elevation) < halfHeight - 0.5);
    }
  {
    for (const area of content.areas.values())
      for (const x of [area.bounds.minX, 0, area.bounds.maxX])
        for (const z of [area.bounds.minZ, 0, area.bounds.maxZ]) {
          const q = compositionPoint(area.id, { x, z }, undefined, worldVisuals[area.id]),
            b = worldVisuals[area.id]!.camera.bounds;
          assert.ok(q.x >= b.minX && q.x <= b.maxX && q.z >= b.minZ && q.z <= b.maxZ);
        }
  }
});
test('skeletons close the last part of their reach and can hit a stationary player', () => {
  const s = new Simulation(content, 142, content.definitions.initialArea, 1),
    enemy = s.enemies[0]!;
  Object.assign(s.hero, { x: enemy.x, z: enemy.z + enemy.definition.melee.range + 0.06 });
  s.move(s.hero, 0, 0);
  for (let i = 0; i < 120; i++) s.step(still);
  assert.ok(s.hero.health < 100, 'an enemy must not swing forever outside its hit range');
  assert.ok(s.enemies[0]!.health === 50);
});
