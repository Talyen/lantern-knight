import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/core/simulation';
import { content } from '../fixtures/content';
import { HEADINGS, selectDirection } from '../../src/content/headings';
import { heroScreenDirections, heroTravelClip } from '../../src/content/hero-locomotion';
import { remapWalkTime } from '../../src/core/locomotion-timing';
import { clipDuration, frameAt } from '../../src/core/animation';
import type { Clip } from '../../src/assets/schema';

test('all eight travel headings face movement regardless of cursor position and retain facing at rest', () => {
  const sim = new Simulation(content);
  for (let f = 0; f < 8; f++)
    for (let t = 0; t < 8; t++) {
      sim.actors = [sim.hero];
      Object.assign(sim.hero, { x: 0, z: 0 });
      const facing = (f * Math.PI) / 4,
        travel = (t * Math.PI) / 4;
      sim.step({
        move: { x: Math.sin(travel), z: Math.cos(travel) },
        aim: { x: Math.sin(facing) * 10, z: Math.cos(facing) * 10 },
      });
      assert.equal(sim.hero.state, 'walk');
      assert.equal(selectDirection(sim.hero.yaw), HEADINGS[t]);
      assert.equal(selectDirection(sim.hero.travelYaw), HEADINGS[t]);
      assert.ok(
        Math.abs(Math.hypot(sim.hero.x, sim.hero.z) - sim.hero.definition.speed / 60) < 1e-8,
      );
      assert.equal(heroTravelClip(selectDirection(sim.hero.travelYaw)), `travel_${HEADINGS[t]}`);
      sim.step({
        move: { x: 0, z: 0 },
        aim: { x: sim.hero.x + Math.sin(facing), z: sim.hero.z + Math.cos(facing) },
      });
      assert.equal(sim.hero.state, 'idle');
      assert.equal(selectDirection(sim.hero.yaw), HEADINGS[t]);
    }
  assert.deepEqual(
    HEADINGS.map((h) => heroScreenDirections[h]),
    ['DL', 'D', 'DR', 'R', 'UR', 'U', 'UL', 'L'],
  );
});

test('facing and travel retain independent heading hysteresis at boundaries', () => {
  assert.equal(selectDirection(Math.PI / 8 + 0.02, 'd00'), 'd00');
  assert.equal(selectDirection(Math.PI / 8 + 0.06, 'd00'), 'd45');
  assert.equal(selectDirection(-Math.PI / 8 - 0.02, 'd00'), 'd00');
  assert.equal(selectDirection(-Math.PI / 8 - 0.06, 'd00'), 'd315');
});

test('travel switches preserve cycle phase across six, seven and eight drawings', () => {
  const clips: Clip[] = [[6, 7, 7, 6, 7, 7], [6, 6, 5, 6, 6, 5, 6], Array(8).fill(5)].map(
    (holds, i) => ({
      frames: holds.map((_, j) => `pose-${i}-${j}`),
      durationsMs: holds.map((n) => (n * 1000) / 60),
      loop: true,
      notifies: [],
    }),
  );
  for (const from of clips)
    for (const to of clips)
      for (const phase of [0, 0.17, 0.49, 0.9, 1.7]) {
        const time = remapWalkTime(from, to, clipDuration(from) * phase);
        assert.ok(Math.abs(time / clipDuration(to) - phase) < 1e-8);
        assert.equal(frameAt(to, time), frameAt(to, clipDuration(to) * phase));
      }
});

test('automatic hero routes face travel and retain facing when the route completes', () => {
  const sim = new Simulation(content);
  sim.actors = [sim.hero];
  Object.assign(sim.hero, { x: 0, z: 0 });
  sim.setMovementTarget(sim.hero.id, { x: 2, z: 0 });
  sim.step({ move: { x: 0, z: 0 }, aim: { x: 0, z: -10 } });
  assert.equal(selectDirection(sim.hero.yaw), 'd90');
  assert.equal(selectDirection(sim.hero.travelYaw), 'd90');
  assert.ok(sim.hero.x > 0);
  for (let i = 0; i < 120; i++) sim.step({ move: { x: 0, z: 0 }, aim: { x: -10, z: 0 } });
  assert.equal(sim.hero.state, 'idle');
  assert.equal(selectDirection(sim.hero.yaw), 'd90');
});

test('returning to idle after an action retains its committed facing as the cursor moves', () => {
  for (const action of ['sword', 'lantern', 'dodge'] as const) {
    const sim = new Simulation(content);
    sim.actors = [sim.hero];
    Object.assign(sim.hero, { x: 0, z: 0 });
    sim.step({ move: { x: 0, z: 0 }, aim: { x: 10, z: 0 }, actions: [action] });
    const facing = sim.hero.yaw;
    assert.equal(facing, Math.PI / 2);
    for (let i = 0; i < 180; i++) sim.step({ move: { x: 0, z: 0 }, aim: { x: -10, z: 0 } });
    assert.equal(sim.hero.state, 'idle');
    assert.equal(sim.hero.yaw, facing, action);
  }
});
