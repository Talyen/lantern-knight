import { content } from '../fixtures/content';
import { sandboxContent } from '../../src/content/sandbox-world';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ContentRegistry, PLAYER_ID, heightAt, surfaceGradient } from '../../src/content/world';
import { contentDefinitions } from '../fixtures/content';
import { GameSession } from '../../src/core/session';
import { tuning, attackDefinition } from '../../src/content/gameplay';
import { Simulation, FixedClock } from '../../src/core/simulation';
import { EventHub, type AnimationEvent } from '../../src/core/events';
import { makeCamera, walkablePoint } from '../../src/core/camera';
import { Input } from '../../src/core/input';
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7);
const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } };

test('input uses the first click position, preserves pending dodge across key repeats, and disposes its listeners', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    target = Object.assign(new EventTarget(), { matches: () => false }),
    canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({
        left: 80,
        top: 70,
        width: 800,
        height: 600,
        right: 880,
        bottom: 670,
      }),
    });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  const input = new Input(canvas as unknown as HTMLCanvasElement, makeCamera(4 / 3), () => {});
  try {
    const sim = new Simulation(content, 142, content.definitions.initialArea, 1),
      rect = canvas.getBoundingClientRect();
    for (const button of [0, 2]) {
      input.resetAim();
      const clientX = 650,
        clientY = 320;
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button, clientX, clientY }));
      const cmd = input.consume(sim.hero, sim.areaDefinition, sim.generation),
        point = walkablePoint(input.camera, clientX, clientY, rect, sim.areaDefinition)!;
      assert.ok(Math.abs(cmd.aim.x - point.x) < 1e-7);
      assert.ok(Math.abs(cmd.aim.z - point.z) < 1e-7);
      assert.equal(cmd.attack, button === 0);
      assert.equal(cmd.ability, button === 2);
    }
    for (const repeat of [false, true])
      target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', repeat }));
    assert.equal(input.consume(sim.hero, sim.areaDefinition, sim.generation).dodge, true);
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', repeat: true }));
    assert.equal(input.consume(sim.hero, sim.areaDefinition, sim.generation).dodge, false);
    input.resetAim();
    input.dispose();
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', repeat: false }));
    canvas.dispatchEvent(
      Object.assign(new Event('pointerdown'), { button: 0, clientX: 650, clientY: 320 }),
    );
    assert.equal(input.keys.size, 0);
    assert.deepEqual(input.edges, { attack: false, dodge: false, ability: false });
    assert.equal(input.hasPointer, false);
  } finally {
    input.dispose();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
function clear(session: GameSession) {
  session.sim.enemies.forEach((a) => session.sim.damage(session.sim.hero, a, 10000));
  session.step(still);
}
function enter(session: GameSession, exit: string) {
  return session.commitTransition(session.prepareTransition(exit));
}

test('content rejects duplicate/unknown IDs and invalid numbers, bounds, ramps and exits', () => {
  for (const mutate of [
    (d: typeof contentDefinitions) => (d.areas = [...d.areas, d.areas[0]!]),
    (d: typeof contentDefinitions) => (d.actors[0]!.radius = NaN),
    (d: typeof contentDefinitions) => (d.areas[0]!.bounds.maxX = -10),
    (d: typeof contentDefinitions) => (d.areas[0]!.spawns[0]!.actor = 'missing'),
    (d: typeof contentDefinitions) => (d.areas[0]!.exits[0]!.entry = 'missing'),
    (d: typeof contentDefinitions) =>
      (d.areas[1]!.surface = {
        kind: 'ramp',
        axis: 'z',
        start: 0,
        end: 0,
        startHeight: 0,
        endHeight: 1,
      }),
  ]) {
    const definitions = structuredClone(contentDefinitions);
    mutate(definitions);
    assert.throws(() => new ContentRegistry(definitions));
  }
  {
    const s = new Simulation(sandboxContent, 12, 'systems-fixture', 1);

    const heavy = s.enemies.find((a) => a.definition.id === 'heavy-warden')!;
    assert.equal(heavy.health, 140);
    assert.equal(heavy.definition.radius, 0.35);
    s.move(heavy, 100, 100);
    assert.equal(heavy.x, 4.65);
    assert.equal(heavy.z, 5.65);
    s.actors.reverse();
    assert.equal(s.hero.id, PLAYER_ID);
    assert.equal(s.hero.definition.id, 'lamplighter');
    const a = s.enemies.find((a) => a.definition.id === 'warden')!;
    Object.assign(s.hero, { x: 0, z: 0, y: heightAt(s.areaDefinition, 0, 0) });
    Object.assign(a, { x: 0.1, z: 0, y: s.hero.y, stun: 10000 });
    Object.assign(heavy, { x: 1, z: 0, y: s.hero.y, stun: 0 });
    s.actors = [s.hero, heavy, a];
    s.start(heavy, 'attack', -Math.PI / 2);
    heavy.age = heavy.definition.melee.windup;
    const result = s.step(still);
    assert.equal(s.hero.health, 80);
    assert.ok(result.events.some((e) => e.kind === 'damage' && e.amount === 20));
  }
});

test('x-ramp support, slope and pointer ray share the same surface independently of fixture axes', () => {
  const area = sandboxContent.area('systems-fixture'),
    camera = makeCamera(16 / 9),
    rect = { left: 80, top: 70, width: 2560, height: 1440 };
  for (const x of [-4, -0.5, 1, 4]) {
    const p = new Vector3(x, heightAt(area, x, 0), 0),
      ndc = p.clone().project(camera),
      q = walkablePoint(
        camera,
        rect.left + ((ndc.x + 1) * rect.width) / 2,
        rect.top + ((1 - ndc.y) * rect.height) / 2,
        rect,
        area,
      )!;
    assert.ok(p.distanceTo(q) < 1e-7);
  }
  assert.ok(Math.abs(surfaceGradient(area, 0, 0).x - 0.1) < 1e-10);
  assert.deepEqual(surfaceGradient(area, 4, 0), { x: 0, z: 0 });
  {
    const c = makeCamera(16 / 9),
      rect = { left: 80, top: 76, width: 2560, height: 1440 };
    for (const z of [-4, -1, 2]) {
      const p = new Vector3(1, heightAt(content.area('upper-landing'), 1, z), z),
        ndc = p.clone().project(c),
        q = walkablePoint(
          c,
          rect.left + ((ndc.x + 1) * rect.width) / 2,
          rect.top + ((1 - ndc.y) * rect.height) / 2,
          rect,
          content.area('upper-landing'),
        )!;
      near(q.x, p.x);
      near(q.y, p.y);
      near(q.z, p.z);
    }
    assert.equal(
      walkablePoint(c, 0, 0, { ...rect, width: 0 }, content.area('upper-landing')),
      null,
    );
  }
});
test('partial and cleared revisits preserve enemies; player cooldowns survive; enemy transient state clears', () => {
  const definitions = structuredClone(contentDefinitions);
  definitions.areas[0]!.exits[0]!.requiresClear = false;
  definitions.areas[1]!.exits[0]!.requiresClear = false;
  const session = new GameSession(new ContentRegistry(definitions));
  const enemy = session.sim.enemies[0]!;
  enemy.health = 25;
  enemy.x = -1;
  enemy.stun = 20;
  session.sim.start(enemy, 'attack');
  session.sim.hero.health = 63;
  session.sim.hero.cooldown = 100;
  session.sim.hero.dodgeCooldown = 20;
  enter(session, 'landing');
  assert.equal(session.sim.hero.z, 7.5);
  assert.equal(session.sim.hero.cooldown, 100);
  assert.equal(session.sim.hero.health, 63);
  enter(session, 'court');
  const restored = session.sim.enemies.find((a) => a.id === enemy.id)!;
  assert.equal(restored.health, 25);
  assert.equal(restored.x, -1);
  assert.equal(restored.stun, 0);
  assert.equal(restored.state, 'idle');
  assert.equal(session.sim.hero.dodgeCooldown, 20);
  clear(session);
  assert.equal(session.wins, 1);
  enter(session, 'landing');
  enter(session, 'court');
  session.step(still);
  assert.ok(session.sim.cleared);
  assert.ok(session.sim.enemies.every((a) => a.health === 0));
  assert.equal(session.wins, 1);
  {
    const session = new GameSession(content);
    let s = session.sim;
    s.hero.health = 55;
    Object.assign(s.hero, { x: 0, z: -5.95 });
    s.enemies.forEach((a) => (a.health = 0));
    const result = session.step(still);
    assert.equal(result.transition, 'landing');
    session.commitTransition(session.prepareTransition(result.transition!));
    s = session.sim;
    assert.equal(s.area, 'upper-landing');
    assert.equal(s.hero.health, 55);
    assert.equal(session.wins, 1);
    assert.equal(s.hero.z, 7.5);
    for (const z of [1, 0, -0.5, -1, -2, -3]) {
      s.hero.z = z;
      s.move(s.hero, 0, 0);
      near(s.hero.y, heightAt(s.areaDefinition, s.hero.x, z));
    }
    near(heightAt(s.areaDefinition, 0, 3.75), 0);
    near(heightAt(s.areaDefinition, 0, -3), 0);
    s.hero.z = 8.3;
    s.enemies.forEach((a) => (a.health = 0));
    session.step(still);
    session.commitTransition(session.prepareTransition('court'));
    assert.equal(session.sim.area, 'court');
    assert.equal(session.wins, 2);
    assert.equal(session.sim.hero.z, -5.5);
    assert.ok(session.sim.cleared);
  }
});
test('death resets only current area and failed/superseded transitions cannot commit', () => {
  const session = new GameSession(content);
  clear(session);
  const first = session.prepareTransition('landing'),
    second = session.prepareTransition('landing'),
    before = session.sim;
  assert.throws(() => session.commitTransition(first), /stale/);
  assert.equal(session.sim, before);
  session.cancelTransition(second);
  assert.equal(session.sim, before);
  assert.ok(!session.loading);
  enter(session, 'landing');
  session.sim.damage(session.sim.enemies[0]!, session.sim.hero, 1000);
  session.sim.hero.age = tuning.deathHoldTicks;
  session.step(still);
  assert.equal(session.resetCount, 1);
  assert.equal(session.sim.hero.health, 100);
  assert.ok(session.sim.enemies.every((a) => a.health === 50));
  clear(session);
  enter(session, 'court');
  assert.ok(session.sim.cleared);
  assert.equal(session.sim.enemies[0]!.health, 0);
});

test('step events are immutable captured values; catch-up delivers all once and disposal rejects late work', () => {
  const s = new Simulation(content, 142, content.definitions.initialArea, 1),
    hub = new EventHub();
  hub.setGeneration(s.generation);
  const received: string[] = [],
    dispose = hub.subscribe((e) => received.push(e.key));
  s.enemies[0]!.health = 5;
  s.damage(s.hero, s.enemies[0]!, 26);
  const damage = s.events.find((e) => e.kind === 'damage')!;
  assert.equal(damage.kind, 'damage');
  if (damage.kind === 'damage') assert.equal(damage.amount, 5);
  const position = damage.position;
  s.hero.x = 3;
  assert.notEqual(position[0], s.hero.x);
  assert.ok(Object.isFrozen(damage));
  assert.ok(Object.isFrozen(s.events));
  hub.publish(s.events);
  hub.publish(s.events);
  assert.equal(received.length, 2);
  const combat = new Simulation(content, 142, content.definitions.initialArea, 1);
  combat.actors = [combat.hero, combat.enemies[0]!];
  Object.assign(combat.hero, { x: 0, z: 1, aim: Math.PI });
  Object.assign(combat.enemies[0]!, { x: 0, z: 0, stun: 10000 });
  combat.startSword(combat.hero, 'sweep');
  combat.hero.age = attackDefinition(combat.hero).windup - 1;
  const delivery = new EventHub(),
    kinds: string[] = [],
    lifetimes: AbortSignal[] = [];
  delivery.setGeneration(combat.generation);
  const remove = delivery.subscribe((event, lifetime) => {
    kinds.push(event.kind);
    lifetimes.push(lifetime);
  });
  const clock = new FixedClock();
  clock.advance(100, () => {
    const result = combat.step(still);
    delivery.publish(result.events);
  });
  assert.deepEqual(kinds, ['strike', 'damage']);
  assert.equal(combat.events.length, 0);
  delivery.setGeneration(combat.generation + 1);
  assert.ok(lifetimes.every((s) => s.aborted));
  remove();
  const visual: AnimationEvent = {
    ...damage,
    key: 'visual-one',
    kind: 'animation-notify',
    notify: 'whoosh',
    clip: 'attack',
    instance: 2,
    timeMs: 20,
  };
  hub.publish([visual, visual]);
  assert.equal(received.filter((k) => k === 'visual-one').length, 1);
  dispose();
  hub.publish([{ ...visual, key: 'visual-two', timeMs: 30 }]);
  const length = received.length;
  hub.setGeneration(s.generation + 1);
  hub.publish([visual]);
  assert.equal(received.length, length);
  hub.dispose();
});
