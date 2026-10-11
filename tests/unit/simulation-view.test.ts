import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../../src/core/simulation';
import { content } from '../fixtures/content';

test('presentation view stays live across ticks and actor replacement without exposing commands', () => {
  const sim = new Simulation(content),
    view = sim.view,
    previousHero = view.hero;
  assert.equal('step' in view, false);
  assert.equal('damage' in view, false);
  assert.equal('populate' in view, false);
  assert.equal(Reflect.set(view, 'tick', 200), false);
  sim.step({ move: { x: 1, z: 0 }, aim: { x: 10, z: 0 } });
  assert.equal(view, sim.view);
  assert.equal(view.tick, 1);
  assert.equal(view.hero.x, sim.hero.x);
  sim.populate();
  assert.notEqual(view.hero, previousHero);
  assert.equal(view.actors, sim.actors);
  sim.collectedPickups.add('collected');
  assert.ok(view.collectedPickups.has('collected'));

  // Compiled by the regular typecheck: every nested gameplay write must fail.
  // oxlint-disable-next-line no-constant-condition -- These forbidden writes are compile-only contract checks.
  if (false) {
    // @ts-expect-error Presentation has no simulation commands.
    view.step();
    // @ts-expect-error Presentation cannot change combat outcomes.
    view.hero.health = 0;
    // @ts-expect-error Presentation cannot replace actors.
    view.actors.pop();
    // @ts-expect-error Presentation cannot change hit tracking.
    view.hero.hitIds.push('target');
    // @ts-expect-error Presentation cannot consume pickups.
    view.collectedPickups.add('pickup');
    // @ts-expect-error Presentation cannot edit accepted content.
    view.hero.definition.melee.damage = 0;
  }
});

test('reading and editing navigation diagnostics cannot change gameplay or retained routes', () => {
  const observed = new Simulation(content),
    control = new Simulation(content),
    command = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
  assert.deepEqual(observed.view.navigationDebug(), { routes: [], cells: [] });
  for (const sim of [observed, control])
    sim.setMovementTarget(sim.hero.id, { x: sim.hero.x + 2, z: sim.hero.z });
  for (let tick = 0; tick < 90; tick++) {
    const diagnostics = observed.view.navigationDebug(tick % 15 === 0);
    diagnostics.routes[0]?.points.splice(0);
    if (diagnostics.routes[0]) diagnostics.routes[0].target.x = 1000;
    assert.deepEqual(observed.step(command), control.step(command));
    assert.deepEqual(observed.actors, control.actors);
  }
  assert.deepEqual(observed.navigationDebug(false), control.navigationDebug(false));
});
