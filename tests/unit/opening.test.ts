import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentRegistry, type AreaDefinition } from '../../src/content/world';
import { content as fixture } from '../fixtures/content';
import { GameSession } from '../../src/core/session';
import { Simulation } from '../../src/core/simulation';
import { attackDefinition, tuning } from '../../src/content/gameplay';
import { windDestination } from '../../src/presentation/guiding-wind';
import { parseGame } from '../../src/core/save';
import { retimeLanternClip } from '../../src/presentation/lantern-timing';
import { heroActionTiming } from '../../src/content/hero-actions';
import { AUTHORED_HEADINGS } from '../../src/content/headings';
const still = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
function registry() {
  const ids = ['abandoned-orchard', 'forest-gathering-clearing'];
  const areas = ids.map((id, i): AreaDefinition => ({
    id,
    name: id,
    subtitle: '',
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    surface: { kind: 'flat', height: 0 },
    seedOffset: 0,
    baselineEntry: 'start',
    entries: [
      { id: 'start', x: 0, z: 0 },
      { id: 'fire-arrival', x: 5, z: 5 },
    ],
    props: [],
    floorColor: 0,
    spawns: [
      { id: 'a', actor: 'skeleton', x: 1, z: 0, rewards: [{ item: 'gold', amount: 4 }] },
      { id: 'b', actor: 'skeleton', x: -1, z: 0 },
    ],
    exits: [
      {
        id: 'depart',
        destination: ids[1 - i]!,
        entry: 'fire-arrival',
        requiresClear: false,
        explicit: true,
        marker: { x: 5, z: 5 },
        trigger: { minX: 4, maxX: 6, minZ: 4, maxZ: 6 },
        guards: [],
      },
    ],
    campfires: [{ id: 'arrival', name: 'Fire', x: 5, z: 5, safeRadius: 1, discovered: i === 0 }],
    interactables: [
      {
        id: 'crate',
        object: 'crate',
        kind: 'breakable',
        x: 0,
        z: 2,
        guards: [],
        rewards: [{ item: 'health-potion', amount: 1 }],
        idle: 'idle',
        action: 'open',
        spent: 'looted',
      },
    ],
  }));
  return new ContentRegistry({ ...fixture.definitions, initialArea: ids[0]!, areas });
}
function duel() {
  const s = new Simulation(registry());
  s.enemies.forEach((a) => (a.stun = 10000));
  return s;
}
function steps(s: Simulation, count: number) {
  for (let i = 0; i < count; i++) s.step(still);
}
for (const kind of ['sword', 'lantern', 'dodge', 'movement'] as const) {
  test(`${kind} waits for the final sword damage tick, then cancels recovery`, () => {
    const s = duel();
    s.startSword(s.hero);
    s.hero.age = attackDefinition(s.hero).activeEnd - 1;
    const target = s.enemies[0]!;
    const health = target.health;
    s.step({
      ...still,
      actions: kind === 'movement' ? [] : [kind],
      move: kind === 'movement' ? { x: 1, z: 0 } : still.move,
    });
    assert.equal(s.hero.state, 'attack');
    assert.equal(target.health, health - tuning.attack.damage);
    s.step({ ...still, move: kind === 'movement' ? { x: 1, z: 0 } : still.move });
    assert.equal(
      s.hero.state,
      kind === 'sword'
        ? 'attack'
        : kind === 'lantern'
          ? 'ability'
          : kind === 'movement'
            ? 'walk'
            : 'dodge',
    );
    assert.equal(s.hero.pendingAction, undefined);
    if (kind === 'sword') assert.equal(s.hero.attackKind, 'lunge');
  });
}
test('latest request wins across and within frames; unavailable requests and movement preserve it', () => {
  const s = duel();
  s.startSword(s.hero);
  s.step({ ...still, actions: ['dodge', 'sword'] });
  assert.equal(s.hero.pendingAction?.kind, 'sword');
  s.step({ ...still, actions: ['lantern'] });
  s.hero.dodgeCooldown = 40;
  s.step({ ...still, actions: ['dodge'], move: { x: 1, z: 0 } });
  assert.equal(s.hero.pendingAction?.kind, 'lantern');
  assert.ok(s.events.some((e) => e.kind === 'action-unavailable'));
  while (s.hero.state === 'attack') s.step(still);
  assert.equal(s.hero.state, 'ability');
});
test('the lantern pulse is protected and survives immediate recovery cancellation', () => {
  const s = duel();
  s.step({ ...still, ability: true });
  s.hero.age = tuning.ability.windup;
  s.step({ ...still, dodge: true });
  assert.equal(s.hero.state, 'ability');
  assert.equal(s.events.filter((e) => e.kind === 'flare').length, 1);
  assert.ok(s.enemies.every((a) => a.burn));
  s.step(still);
  assert.equal(s.hero.state, 'dodge');
  assert.equal(s.events.filter((e) => e.kind === 'flare').length, 0);
});
test('dodge travel/invulnerability is protected; recovery yields and hurt queues until finished', () => {
  const s = duel();
  s.step({ ...still, dodge: true });
  s.hero.age = tuning.dodge.invulnerableEnd - 1;
  s.step({ ...still, ability: true });
  assert.equal(s.hero.state, 'dodge');
  s.step(still);
  assert.equal(s.hero.state, 'ability');
  s.damage(s.enemies[0]!, s.hero, 1);
  assert.equal(s.hero.pendingAction, undefined);
  s.step({ ...still, attack: true });
  assert.equal(s.hero.state, 'hurt');
  steps(s, tuning.hurt.total);
  assert.equal(s.hero.state, 'attack');
});
test('incoming interruption and stale commands cannot replay a queued action', () => {
  const s = duel();
  s.startSword(s.hero);
  s.step({ ...still, ability: true });
  s.damage(s.enemies[0]!, s.hero, 1);
  assert.equal(s.hero.pendingAction, undefined);
  steps(s, tuning.hurt.total + 2);
  s.step({ ...still, actions: ['lantern'], generation: s.generation - 1 });
  assert.equal(s.hero.state, 'idle');
  assert.equal(s.hero.cooldown, 0);
  s.startSword(s.hero);
  s.step({ ...still, dodge: true });
  s.damage(s.enemies[0]!, s.hero, 1000);
  assert.equal(s.hero.pendingAction, undefined);
});
test('burst is circular, bounded by range, obstruction and height, with one direct hit', () => {
  for (const [x, z, y, hit] of [
    [-2.5, 0, 0, true],
    [0, 2.501, 0, false],
    [1, 0, 1, false],
  ] as const) {
    const s = duel();
    const a = s.enemies[0]!;
    Object.assign(a, { x, z, y });
    const health = a.health;
    s.step({ ...still, ability: true });
    steps(s, tuning.ability.windup);
    assert.equal(a.health, health - (hit ? 16 : 0));
    assert.equal(s.events.filter((e) => e.kind === 'flare').length, 1);
    steps(s, 10);
    assert.equal(a.health, health - (hit ? 16 : 0));
  }
  const definitions = registry().definitions;
  const blocked = new ContentRegistry({
    ...definitions,
    areas: definitions.areas.map((a) => ({
      ...a,
      props: [
        {
          id: 'wall',
          kind: 'wall' as const,
          x: 0.5,
          z: 0,
          radius: 0.1,
          height: 2,
          size: [0.1, 3] as const,
          shape: 'box' as const,
          blocking: true,
        },
      ],
    })),
  });
  const s = new Simulation(blocked);
  s.enemies.forEach((a) => (a.stun = 10000));
  s.step({ ...still, ability: true });
  steps(s, tuning.ability.windup);
  assert.equal(s.enemies[0]!.burn, undefined);
});
test('Burn ticks preserve attacks and movement, refresh without postponing cadence, and expire after three ticks', () => {
  const s = duel();
  const a = s.enemies[0]!;
  a.burn = { remaining: 180, nextTick: 1 };
  s.start(a, 'attack');
  a.age = 3;
  const action = a.action;
  s.step(still);
  assert.equal(a.state, 'attack');
  assert.equal(a.action, action);
  assert.equal(a.age, 4);
  assert.ok(
    s.events.some((e) => e.kind === 'damage' && e.phase === 'over-time' && e.damageType === 'burn'),
  );
  a.burn = { remaining: 100, nextTick: 20 };
  s.start(s.hero, 'ability');
  s.hero.age = tuning.ability.windup;
  s.step(still);
  assert.deepEqual(a.burn, { remaining: 180, nextTick: 19 });
  const health = a.health;
  steps(s, 180);
  assert.equal(a.health, health - 12);
  assert.equal(a.burn, undefined);
});
test('Burn defeat awards one drop and clears status, even on later ticks', () => {
  const s = duel();
  const a = s.enemies[0]!;
  a.health = 4;
  a.burn = { remaining: 180, nextTick: 1 };
  s.step(still);
  assert.equal(a.health, 0);
  assert.equal(a.burn, undefined);
  steps(s, 100);
  assert.equal(s.drops.filter((d) => d.source === 'a').length, 1);
});
test('Burn timers and onboarding survive save/load and inactive destinations; resets clear Burn and input queues', () => {
  const r = registry();
  const session = new GameSession(r);
  session.sim.enemies[0]!.burn = { remaining: 100, nextTick: 20 };
  session.dismissLesson('sword');
  session.completeLesson('dodge');
  const save = session.captureSave();
  session.restoreSave(save);
  assert.deepEqual(session.sim.enemies[0]!.burn, { remaining: 100, nextTick: 20 });
  assert.ok(session.onboarding.dismissed.includes('sword'));
  assert.ok(session.onboarding.completed.includes('dodge'));
  Object.assign(session.sim.hero, { x: 5, z: 5 });
  session.commitRoom(session.prepareTransition('depart'));
  session.step(still);
  assert.deepEqual(session.captureSave().areas['abandoned-orchard']!.actors.a!.burn, {
    remaining: 100,
    nextTick: 20,
  });
  session.discoverFire('forest-gathering-clearing/arrival');
  session.commitRoom(session.prepareFireTravel('abandoned-orchard/arrival'));
  assert.deepEqual(session.sim.enemies[0]!.burn, { remaining: 100, nextTick: 20 });
  assert.ok(session.onboarding.completed.includes('travel'));
  session.sim.hero.pendingAction = { kind: 'lantern', yaw: 0 };
  session.rest('abandoned-orchard/arrival');
  assert.equal(session.sim.hero.pendingAction, undefined);
  assert.equal(session.sim.enemies[0]!.burn, undefined);
  assert.ok(session.onboarding.dismissed.includes('sword'));
  const old = session.captureSave();
  delete old.adventure!.onboarding;
  const restored = new GameSession(r);
  restored.restoreSave(parseGame(old, r));
  assert.deepEqual(restored.onboarding, { completed: [], dismissed: [] });
  session.sim.enemies[0]!.burn = { remaining: 100, nextTick: 20 };
  session.resetCurrentArea('death');
  assert.equal(session.sim.enemies[0]!.burn, undefined);
});
test('all cast directions share the 200ms pulse and retain the delivered raised pose', () => {
  for (const heading of AUTHORED_HEADINGS) {
    const frames = Array.from({ length: 8 }, (_, i) => `${heading}-${i}`);
    const clip = retimeLanternClip(
      {
        frames,
        durationsMs: [1000 / 30, 100, 700 / 6, 150, 100, 150, 150, 200],
        notifies: [{ id: 'flash', kind: 'flash', atMs: 400 }],
        loop: false,
      },
      heading,
    );
    assert.deepEqual(clip.frames, frames);
    assert.equal(clip.notifies[0]!.atMs, 200);
    assert.equal(heroActionTiming('cast_lantern_flare', heading).windup, 12);
    assert.equal(Math.round(clip.durationsMs.reduce((a, b) => a + b, 0)), 800);
  }
});

test('malformed saved Burn timers and duplicate hint histories cannot enter a session', () => {
  const session = new GameSession(registry());
  const before = session.captureSave();
  const invalidBurn = structuredClone(before);
  invalidBurn.areas[invalidBurn.area]!.actors.a!.burn = { remaining: 1, nextTick: 60 };
  assert.throws(() => session.restoreSave(invalidBurn));
  const duplicate = structuredClone(before);
  duplicate.adventure!.onboarding = { completed: ['sword'], dismissed: ['sword'] };
  assert.throws(() => session.restoreSave(duplicate));
  assert.deepEqual(session.captureSave(), before);
});

test('environmental guidance suggests nearby supplies and the path, yields during combat and death', () => {
  const defs = registry().definitions;
  const r = new ContentRegistry({
    ...defs,
    areas: defs.areas.map((a) => ({
      ...a,
      spawns: a.spawns.map((s) => ({ ...s, awareness: { radius: 3, leash: 5 } })),
    })),
  });
  const s = new Simulation(r);
  s.enemies.forEach((a) => Object.assign(a, { x: 8, z: 8 }));
  assert.equal(windDestination(s.view)?.z, 2);
  s.claimedObjects.add('crate');
  assert.equal(windDestination(s.view)?.x, 5);
  s.enemies[0]!.x = s.hero.x;
  s.enemies[0]!.z = s.hero.z;
  s.engaged = true;
  s.step(still);
  assert.equal(windDestination(s.view), undefined);
  s.hero.health = 0;
  assert.equal(windDestination(s.view), undefined);
});

test('clearing wind suggests the ruins, their dropped reward, then the resting fire', () => {
  const defs = registry().definitions;
  const r = new ContentRegistry({
    ...defs,
    areas: defs.areas.map((a) => ({
      ...a,
      spawns: [],
      interactables: a.interactables?.map((o) => ({ ...o, kind: 'container' as const })),
    })),
  });
  const s = new Simulation(r, 142, 'forest-gathering-clearing');
  assert.equal(windDestination(s.view)?.z, 2);
  s.claimedObjects.add('crate');
  s.drops.push({
    id: 'object-crate-0',
    source: 'crate',
    enemy: false,
    x: 1,
    z: 2,
    rewards: [{ item: 'health-potion', amount: 1 }],
  });
  assert.equal(windDestination(s.view)?.x, 1);
  s.drops.length = 0;
  assert.equal(windDestination(s.view)?.x, 5);
});
