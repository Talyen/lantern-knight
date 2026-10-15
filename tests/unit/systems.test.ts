import { onExit } from '../../tools/scope-exit';
import { mockGlobals } from '../fixtures/globals';
import { content, contentDefinitions } from '../fixtures/content';
import { sandboxContent } from '../../src/content/sandbox-world';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { ContentRegistry, PLAYER_ID, heightAt, surfaceGradient } from '../../src/content/world';
import { GameSession } from '../../src/core/session';
import { parseGame } from '../../src/core/save';
import { tuning, attackDefinition } from '../../src/content/gameplay';
import { Simulation, FixedClock } from '../../src/core/simulation';
import { EventHub, type AnimationEvent } from '../../src/core/events';
import { makeCamera, walkablePoint } from '../../src/presentation/camera';
import { Input } from '../../src/input';
import { bindAdventureUI } from '../../src/adventure-ui';
import type { Application } from '../../src/application';
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7);
const still = { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 } };

test('adventure hotkeys ignore editable content and descendants of focused controls', (t) => {
  const doc = Object.assign(new EventTarget(), {
    createElement: () =>
      Object.assign(new EventTarget(), {
        setAttribute() {},
        close() {},
        remove() {},
      }),
  });
  mockGlobals(t, { document: doc });
  let interactions = 0;
  const app = {
    paused: false,
    busy: false,
    roomReady: true,
    interact() {
      interactions++;
    },
    audio: { play: async () => {} },
    hooks: { status() {} },
  } as unknown as Application;
  const lifetime = new AbortController();
  bindAdventureUI(app, { append() {} } as unknown as HTMLElement, lifetime.signal);
  using _scopeExit1 = onExit(() => {
    lifetime.abort();
  });
  for (const target of [
    { isContentEditable: true, closest: () => null },
    { closest: (selector: string) => (selector.includes('button') ? {} : null) },
  ]) {
    const event = Object.assign(new Event('keydown'), { code: 'KeyE' });
    Object.defineProperty(event, 'target', { value: target });
    doc.dispatchEvent(event);
  }
  assert.equal(interactions, 0);
  doc.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyE' }));
  assert.equal(interactions, 1, 'canvas and window shortcuts remain available');
});

test('encounter retries preserve elapsed session ticks across generations', () => {
  const session = new GameSession(content);
  let elapsed = 0;
  for (const reason of ['manual', 'death'] as const) {
    for (let i = 0; i < 20; i++) {
      session.step(still);
      elapsed++;
    }
    const generation = session.generation;
    const events = session.resetCurrentArea(reason);
    assert.equal(session.generation, generation + 1);
    assert.equal(session.sim.tick, elapsed);
    assert.equal(events[0]!.tick, elapsed);
  }
});

test('input uses the first click position, preserves pending dodge across key repeats, and disposes its listeners', (t) => {
  const target = Object.assign(new EventTarget(), {
      matches: (_selector: string): boolean => false,
      closest(selector: string): object | null {
        return this.matches(selector) ? this : null;
      },
    }),
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
  mockGlobals(t, { window: target });
  let pauses = 0;
  const input = new Input(canvas as unknown as HTMLCanvasElement, makeCamera(4 / 3), () => {
    pauses++;
  });
  using _cleanup2 = onExit(() => input.dispose());
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
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    canvas.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        button: 0,
        clientX: 650,
        clientY: 320,
        [modifier]: true,
      }),
    );
    assert.equal(
      input.consume(sim.hero, sim.areaDefinition, sim.generation).attack,
      false,
      'modified pointer gestures must not trigger combat',
    );
  }
  for (const repeat of [false, true])
    target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', repeat }));
  assert.equal(input.consume(sim.hero, sim.areaDefinition, sim.generation).dodge, true);
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', repeat: true }));
  assert.equal(input.consume(sim.hero, sim.areaDefinition, sim.generation).dodge, false);
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  assert.ok(input.keys.has('KeyW'));
  target.matches = () => true;
  target.dispatchEvent(new Event('focusin'));
  assert.equal(input.keys.size, 0, 'focusing a text field releases held movement');
  target.matches = () => false;
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  target.matches = (selector: string) => selector.includes('button');
  target.dispatchEvent(new Event('focusin'));
  assert.equal(input.keys.size, 0, 'focusing a button releases held movement');
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', repeat: false }));
  assert.equal(input.keys.size, 0, 'focused buttons cannot move the hero');
  assert.equal(input.edges.dodge, false, 'focused buttons cannot trigger combat');
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape', repeat: false }));
  assert.equal(pauses, 1, 'Escape still toggles pause from a focused button');
  input.clear();
  target.matches = () => false;
  target.closest = (selector) => (selector.includes('button') ? {} : null);
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', repeat: false }));
  assert.equal(input.keys.size, 0, 'descendants of controls cannot move the hero');
  input.keys.add('KeyW');
  target.dispatchEvent(new Event('focusin'));
  assert.equal(input.keys.size, 0, 'focus inside a control releases held movement');
  target.closest = () => null;
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    target.dispatchEvent(
      Object.assign(new Event('keydown'), {
        code: 'KeyW',
        repeat: false,
        [modifier]: true,
      }),
    );
    assert.equal(input.keys.size, 0, 'application shortcuts cannot move the hero');
  }
  input.resetAim();
  input.dispose();
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'ShiftLeft', repeat: false }));
  canvas.dispatchEvent(
    Object.assign(new Event('pointerdown'), { button: 0, clientX: 650, clientY: 320 }),
  );
  assert.equal(input.keys.size, 0);
  assert.deepEqual(input.edges, { attack: false, dodge: false, ability: false, potion: false });
  assert.equal(input.hasPointer, false);
});
function clear(session: GameSession) {
  session.sim.enemies.forEach((a) => session.sim.damage(session.sim.hero, a, 10000));
  session.step(still);
}
function enter(session: GameSession, exit: string) {
  return session.commitRoom(session.prepareTransition(exit));
}

test('accepted content isolates live sessions and checkpoints from later draft edits', () => {
  const draft = structuredClone(contentDefinitions);
  const registry = new ContentRegistry(draft);
  const session = new GameSession(registry);
  const save = session.captureSave();
  const area = registry.area(save.area);
  const enemy = session.sim.enemies[0]!;
  const health = enemy.definition.maxHealth;

  draft.areas[0]!.bounds.maxX = -100;
  draft.areas[0]!.spawns[0]!.actor = 'missing';
  draft.actors[0]!.maxHealth = 1;
  draft.areas = [];
  assert.equal(registry.area(save.area), area);
  assert.equal(area.spawns[0]!.actor, 'skeleton');
  assert.equal(enemy.definition.maxHealth, health);
  assert.equal(registry.definitions.areas[0], area);
  assert.equal(registry.actor(enemy.definition.id), enemy.definition);
  assert.equal(Reflect.set(area.bounds, 'maxX', -100), false);
  assert.equal(Reflect.set(enemy.definition.melee, 'damage', 10000), false);
  assert.equal(Reflect.set(registry.definitions.areas, '0', undefined), false);
  assert.equal(Reflect.set(registry, 'definitions', draft), false);
  assert.deepEqual(parseGame(save, registry), save);
  session.restoreSave(save);
  assert.deepEqual(session.captureSave(), save);
  session.step(still);
});

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
    assert.ok(Math.abs(heavy.x - 4.65) < 1e-5);
    assert.ok(Math.abs(heavy.z - 5.65) < 1e-5);
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
    session.commitRoom(session.prepareTransition(result.transition!));
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
    session.commitRoom(session.prepareTransition('court'));
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
  assert.throws(() => session.commitRoom(first), /stale/);
  assert.equal(session.sim, before);
  session.cancelRoom(second);
  assert.equal(session.sim, before);
  assert.ok(!session.loading);
  enter(session, 'landing');
  session.sim.damage(session.sim.enemies[0]!, session.sim.hero, 1000);
  session.sim.hero.age = tuning.deathHoldTicks;
  const reset = session.step(still).reset;
  assert.equal(reset, 'death');
  session.resetCurrentArea(reset);
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

test('event delivery serializes re-entry and snapshots subscribers without losing a committed batch', () => {
  const sim = new Simulation(content),
    hub = new EventHub();
  hub.setGeneration(sim.generation);
  sim.damage(sim.hero, sim.enemies[0]!, 1000);
  const [damage, death] = sim.events;
  assert.ok(damage && death);
  const nested = { ...damage, key: 'nested', tick: damage.tick + 1 };
  const first: string[] = [],
    second: string[] = [],
    added: string[] = [];
  hub.subscribe((event) => {
    first.push(event.key);
    if (event.key === damage.key) {
      hub.subscribe((next) => added.push(next.key));
      hub.publish([nested]);
    }
  });
  hub.subscribe((event) => second.push(event.key));
  hub.publish([damage, death]);
  assert.deepEqual(first, [damage.key, death.key, nested.key]);
  assert.deepEqual(second, first);
  assert.deepEqual(added, [death.key, nested.key]);
  assert.deepEqual(
    hub.history.map((event) => event.key),
    first,
  );
});

test('generation replacement and disposal stop in-flight delivery and abort re-entry uses fresh lifetimes', () => {
  const failures: unknown[] = [];
  const sim = new Simulation(content),
    hub = new EventHub((error) => failures.push(error));
  hub.setGeneration(sim.generation);
  const event = sim.emit(sim.hero, { kind: 'flare' });
  const received: string[] = [],
    lifetimes: AbortSignal[] = [],
    peerLifetimes: AbortSignal[] = [];
  const prime = { ...event, key: 'prime' };
  const next = { ...event, key: 'next', generation: sim.generation + 1 };
  hub.subscribe((current, lifetime) => {
    lifetimes.push(lifetime);
    if (current.key === event.key) {
      lifetime.addEventListener('abort', () => hub.publish([next]), { once: true });
      hub.setGeneration(next.generation);
    }
  });
  hub.subscribe((current, lifetime) => {
    peerLifetimes.push(lifetime);
    received.push(current.key);
    if (current.key === prime.key) return;
    assert.deepEqual(current, next);
    assert.equal(lifetimes[0]!.aborted, true);
    assert.equal(peerLifetimes[0]!.aborted, true);
    assert.notEqual(lifetime, peerLifetimes[0]);
    assert.equal(lifetime.aborted, false);
    hub.dispose();
    hub.publish([{ ...next, key: 'after-disposal' }]);
    hub.setGeneration(next.generation + 1);
  });
  hub.subscribe((current) => {
    if (current.key !== prime.key) assert.fail('stale or disposed delivery');
  });
  hub.publish([prime]);
  hub.publish([event, { ...event, key: 'queued-old' }]);
  assert.deepEqual(received, ['prime', 'next']);
  assert.deepEqual(failures, []);
  assert.ok(lifetimes.every((lifetime) => lifetime.aborted));
  assert.deepEqual(hub.history, []);
  assert.throws(() => hub.subscribe(() => {}), /disposed/);
});

test('failed feedback is removed once; synchronous and asynchronous failures cannot interrupt peers', async () => {
  const sim = new Simulation(content),
    failures: unknown[] = [];
  const hub = new EventHub((error) => {
    failures.push(error);
    throw new Error('diagnostics unavailable');
  });
  hub.setGeneration(sim.generation);
  const event = sim.emit(sim.hero, { kind: 'flare' });
  const received: string[] = [],
    lifetimes: AbortSignal[] = [];
  const sync = new Error('UI failed'),
    asyncError = new Error('async feedback failed');
  hub.subscribe((_, lifetime) => {
    lifetimes.push(lifetime);
    throw sync;
  });
  hub.subscribe(async (_, lifetime) => {
    lifetimes.push(lifetime);
    throw asyncError;
  });
  hub.subscribe((current) => received.push(current.key));
  assert.doesNotThrow(() => hub.publish([event]));
  await Promise.resolve();
  hub.publish([{ ...event, key: 'second' }]);
  assert.deepEqual(received, [event.key, 'second']);
  assert.deepEqual(failures, [sync, asyncError]);
  assert.equal(lifetimes.length, 2);
  assert.ok(lifetimes.every((lifetime) => lifetime.aborted));

  hub.setGeneration(sim.generation + 1);
  const old = { ...event, generation: sim.generation + 1 };
  // Reserve pending work in one generation, then reject it after replacement.
  const { promise: late, reject: lateReject } = Promise.withResolvers<void>();
  hub.subscribe(() => late);
  hub.publish([old]);
  hub.setGeneration(sim.generation + 2);
  lateReject(new Error('obsolete feedback'));
  await Promise.resolve();
  assert.deepEqual(failures, [sync, asyncError]);
  hub.publish([{ ...event, generation: sim.generation + 2, key: 'fresh' }]);
  lateReject(new Error('current feedback'));
  await Promise.resolve();
  assert.equal(failures.length, 3);
  hub.dispose();
});

test('keyboard events on a non-element target do not crash the input listener', (t) => {
  const target = new EventTarget();
  mockGlobals(t, { window: target });
  const input = new Input(new EventTarget() as HTMLCanvasElement, makeCamera(1), () => {});
  using _cleanup1 = onExit(() => input.dispose());
  target.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW' }));
  assert.ok(input.keys.has('KeyW'));
  target.dispatchEvent(new Event('focusin'));
});

test('resetting the fixed clock inside a step discards pending time without delaying the next frame', () => {
  const clock = new FixedClock();
  let steps = 0;
  clock.advance(50, () => {
    steps++;
    clock.reset();
  });
  assert.equal(steps, 1);
  assert.equal(clock.accumulator, 0);
  clock.advance(clock.stepMs, () => {
    steps++;
  });
  assert.equal(steps, 2);
});

test('invalid movement cannot corrupt the hero position or dodge heading', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const sim = new Simulation(content);
    const before = { x: sim.hero.x, z: sim.hero.z };
    const aim = { x: before.x + 1, z: before.z };
    sim.step({ move: { x: value, z: 1 }, aim });
    assert.deepEqual({ x: sim.hero.x, z: sim.hero.z }, before);
    assert.equal(sim.hero.state, 'idle');
    sim.step({ move: { x: value, z: 1 }, aim, dodge: true });
    assert.ok(Number.isFinite(sim.hero.yaw));
    for (let i = 0; i < tuning.dodge.total; i++) sim.step(still);
    assert.ok(Number.isFinite(sim.hero.x + sim.hero.y + sim.hero.z));
  }
});

test('invalid movement destinations preserve the existing route and a loadable checkpoint', () => {
  const session = new GameSession(content),
    sim = session.sim;
  sim.setMovementTarget(sim.hero.id, { x: 1, z: 6 });
  const routes = sim.navigationDebug(false).routes;
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => sim.setMovementTarget(sim.hero.id, { x: value, z: 6 }), /finite/i);
    assert.deepEqual(sim.navigationDebug(false).routes, routes);
  }
  session.step(still);
  assert.doesNotThrow(() => parseGame(session.captureSave(), content));
});

test('invalid frame deltas leave the clock usable for the next valid frame', () => {
  const clock = new FixedClock();
  clock.advance(clock.stepMs / 2, () => assert.fail('premature tick'));
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(
      clock.advance(value, () => assert.fail('invalid frame tick')),
      0.5,
    );
    assert.equal(clock.droppedMs, 0);
  }
  let ticks = 0;
  clock.advance(clock.stepMs / 2, () => {
    ticks++;
  });
  assert.equal(ticks, 1);
});

test('feedback owns immutable event batches across reentrant publication and history', () => {
  const failures: unknown[] = [];
  const hub = new EventHub((error) => failures.push(error));
  hub.setGeneration(1);
  const make = (key: string): AnimationEvent => ({
    key,
    tick: 0,
    generation: 1,
    actor: 'hero',
    action: 0,
    area: 'court',
    position: [1, 2, 3],
    direction: 0,
    kind: 'animation-notify',
    notify: 'footstep',
    clip: 'walk',
    instance: 1,
    timeMs: 0,
  });
  const first = make('first'),
    queued = make('queued');
  const seen: string[] = [];
  hub.subscribe((event) => {
    if (event.key === 'first') {
      hub.publish([queued]);
      Reflect.set(queued, 'key', 'corrupted');
      Reflect.set(queued.position, '0', 99);
    }
    assert.equal(Reflect.set(event, 'notify', 'corrupted'), false);
    assert.equal(Reflect.set(event.position, '0', 99), false);
  });
  hub.subscribe((event) => {
    seen.push(event.key);
    assert.equal(event.position[0], 1);
  });
  hub.publish([first]);
  assert.deepEqual(failures, []);
  assert.deepEqual(seen, ['first', 'queued']);
  assert.deepEqual(
    hub.history.map((event) => event.key),
    seen,
  );
  assert.equal(Reflect.set(hub.history, '0', queued), false);
  hub.dispose();
});
