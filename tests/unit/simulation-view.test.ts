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
});

test('reading and editing navigation diagnostics cannot change gameplay or retained routes', () => {
  const observed = new Simulation(content),
    control = new Simulation(content),
    command = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
  assert.deepEqual(observed.view.navigationDebug(), { routes: [], cells: [] });
  for (const sim of [observed, control])
    sim.setMovementTarget(sim.hero.id, { x: sim.hero.x + 2, z: sim.hero.z });
  for (let tick = 0; tick < 30; tick++) {
    const diagnostics = observed.view.navigationDebug(tick % 15 === 0);
    diagnostics.routes[0]?.points.splice(0);
    if (diagnostics.routes[0]) diagnostics.routes[0].target.x = 1000;
    assert.deepEqual(observed.step(command), control.step(command));
  }
  assert.deepEqual(observed.navigationDebug(false), control.navigationDebug(false));
});

test('preview actor replacements drive live queries, movement and damage admission', () => {
  const sim = new Simulation(content);
  const previous = sim.enemies[0]!;
  const hero = sim.create(sim.hero.id, 'hero', sim.hero.x, sim.hero.z);
  const enemy = sim.create(previous.id, 'enemy', previous.x, previous.z);
  sim.actors = [hero, enemy];
  assert.equal(sim.view.hero, hero);
  assert.deepEqual(sim.view.enemies, [enemy]);
  assert.equal(sim.setMovementTarget(enemy.id, { x: enemy.x, z: enemy.z }), true);
  assert.equal(sim.navigationDebug(false).routes[0]!.id, enemy.id);
  sim.damage(hero, previous, 1);
  assert.equal(previous.health, previous.definition.maxHealth, 'retired actors reject damage');
  sim.damage(hero, enemy, 1);
  assert.equal(enemy.health, enemy.definition.maxHealth - 1);
  sim.actors.splice(1, 1);
  assert.deepEqual(sim.view.enemies, []);
  assert.equal(sim.setMovementTarget(enemy.id, null), false);
  sim.damage(hero, enemy, 1);
  assert.equal(enemy.health, enemy.definition.maxHealth - 1);
});
