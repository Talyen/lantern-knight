import { interactable } from '../fixtures/world';
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
      interactable({
        id: 'crate',
        object: 'crate',
        kind: 'breakable',
        z: 2,
        rewards: [{ item: 'health-potion', amount: 1 }],
      }),
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
  s.step({ ...still, actions: ['lantern'] });
  s.hero.age = tuning.ability.windup;
  s.step({ ...still, actions: ['dodge'] });
  assert.equal(s.hero.state, 'ability');
  assert.equal(s.events.filter((e) => e.kind === 'flare').length, 1);
  assert.ok(s.enemies.every((a) => a.burn));
  s.step(still);
  assert.equal(s.hero.state, 'dodge');
  assert.equal(s.events.filter((e) => e.kind === 'flare').length, 0);
});
test('a lantern burst drives nearby undead back while interrupting their attack', () => {
  const s = duel(),
    [first, second] = s.enemies;
  s.start(first!, 'attack');
  first!.age = first!.definition.attack.windup;
  s.start(s.hero, 'ability');
  s.hero.age = tuning.ability.windup;
  s.step(still);
  assert.equal(first!.state, 'hurt');
  assert.equal(s.hero.health, tuning.heroMaxHealth);
  assert.ok(first!.x > 1 && second!.x < -1);
  steps(s, tuning.ability.recoilTicks - 1);
  assert.ok(Math.abs(first!.x - (1 + tuning.ability.recoilDistance)) < 1e-8);
  assert.ok(Math.abs(second!.x + (1 + tuning.ability.recoilDistance)) < 1e-8);
  const settled = first!.x;
  steps(s, 3);
  assert.equal(first!.x, settled);
  assert.ok(first!.stun > 0 && first!.burn);
});
test('loading a checkpoint keeps the displaced position without replaying lantern recoil', () => {
  const session = new GameSession(registry());
  session.sim.enemies.forEach((actor) => (actor.stun = 10000));
  session.sim.start(session.sim.hero, 'ability');
  session.sim.hero.age = tuning.ability.windup;
  session.step(still);
  const save = session.captureSave(),
    position = { x: session.sim.enemies[0]!.x, z: session.sim.enemies[0]!.z };
  assert.ok(session.onboarding.completed.includes('lantern'));
  session.restoreSave(save);
  const enemy = session.sim.enemies[0]!;
  enemy.stun = 100;
  steps(session.sim, tuning.ability.recoilTicks);
  assert.deepEqual({ x: enemy.x, z: enemy.z }, position);
  assert.ok(enemy.burn);
  assert.ok(session.onboarding.completed.includes('lantern'));
});
test('dodge travel/invulnerability is protected; recovery yields and hurt queues until finished', () => {
  const s = duel();
  s.step({ ...still, actions: ['dodge'] });
  s.hero.age = tuning.dodge.invulnerableEnd - 1;
  s.step({ ...still, actions: ['lantern'] });
  assert.equal(s.hero.state, 'dodge');
  s.step(still);
  assert.equal(s.hero.state, 'ability');
  s.damage(s.enemies[0]!, s.hero, 1);
  assert.equal(s.hero.pendingAction, undefined);
  s.step({ ...still, actions: ['sword'] });
  assert.equal(s.hero.state, 'hurt');
  steps(s, tuning.hurt.total);
  assert.equal(s.hero.state, 'attack');
});
test('incoming interruption and stale commands cannot replay a queued action', () => {
  const s = duel();
  s.startSword(s.hero);
  s.step({ ...still, actions: ['lantern'] });
  s.damage(s.enemies[0]!, s.hero, 1);
  assert.equal(s.hero.pendingAction, undefined);
  steps(s, tuning.hurt.total + 2);
  s.step({ ...still, actions: ['lantern'], generation: s.generation - 1 });
  assert.equal(s.hero.state, 'idle');
  assert.equal(s.hero.cooldown, 0);
  s.startSword(s.hero);
  s.step({ ...still, actions: ['dodge'] });
  s.damage(s.enemies[0]!, s.hero, 1000);
  assert.equal(s.hero.pendingAction, undefined);
});
test('burst is circular, bounded by range and height, with one direct hit', () => {
  for (const [x, z, y, hit] of [
    [-3.25, 0, 0, true],
    [3.25, 0, 0, true],
    [0, -3.25, 0, true],
    [0, 3.25, 0, true],
    [0, 3.251, 0, false],
    [1, 0, 1, false],
  ] as const) {
    const s = duel();
    const a = s.enemies[0]!;
    Object.assign(a, { x, z, y });
    const health = a.health;
    s.step({ ...still, actions: ['lantern'] });
    steps(s, tuning.ability.windup);
    assert.equal(a.health, health - (hit ? 16 : 0));
    assert.equal(s.events.filter((e) => e.kind === 'flare').length, 1);
    assert.equal(s.hero.hitIds.filter((id) => id === a.id).length, hit ? 1 : 0);
    assert.ok(s.hero.cooldown > 0);
    steps(s, tuning.ability.total - tuning.ability.windup);
    assert.equal(a.health, health - (hit ? 16 : 0));
  }
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
test('A due burn pulse fires instead of stalling when its tick reaches zero', () => {
  const s = duel();
  const a = s.enemies[0]!;
  const health = a.health;
  a.burn = { remaining: 180, nextTick: 0 };
  s.step(still);
  assert.equal(a.health, health - tuning.ability.burnDamage);
  assert.deepEqual(a.burn, { remaining: 179, nextTick: tuning.ability.burnCadence });
});
test('a downed hero cannot keep burning enemies or win the encounter', () => {
  const s = duel();
  const a = s.enemies[0]!;
  s.hero.health = 0;
  s.start(s.hero, 'death');
  a.health = 3;
  a.burn = { remaining: 300, nextTick: 1 };
  const events = s.step(still).events;
  assert.equal(a.health, 3);
  assert.equal(s.cleared, false);
  assert.ok(!events.some((e) => e.kind === 'room-clear'));
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
  invalidBurn.areas[invalidBurn.area]!.actors.a!.burn = { remaining: 1, nextTick: 0 };
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

test('orchard wind follows discoveries, allows bypasses and preserves progress across respawns', () => {
  const defs = registry().definitions;
  const r = new ContentRegistry({
    ...defs,
    areas: defs.areas.map((a) => ({
      ...a,
      spawns: [{ id: 'first', actor: 'skeleton', x: 1, z: -2, awareness: { radius: 2, leash: 4 } }],
      interactables: [
        { ...a.interactables![0]!, id: 'southern-cache', kind: 'container' as const, x: 0, z: 2 },
        { ...a.interactables![0]!, id: 'guarded-chest', kind: 'container' as const, x: 0, z: -6 },
      ],
    })),
  });
  const s = new Simulation(r);
  const destination = () => windDestination(s.view);
  assert.equal(destination()?.z, 2);
  s.claimedObjects.add('southern-cache');
  s.drops.push({
    id: 'camp-reward',
    source: 'southern-cache',
    enemy: false,
    x: 0,
    z: 2,
    rewards: [{ item: 'travellers-charm', amount: 1 }],
  });
  assert.equal(destination()?.z, 2, 'opening the satchel still guides to its reward');
  s.drops.length = 0;
  assert.equal(destination()?.z, -2);
  s.enemies[0]!.health = 0;
  assert.equal(destination()?.z, -6);
  s.claimedObjects.add('guarded-chest');
  s.drops.push({
    id: 'press-reward',
    source: 'guarded-chest',
    enemy: false,
    x: 0,
    z: -6,
    rewards: [{ item: 'orchard-ring', amount: 1 }],
  });
  assert.equal(destination()?.z, -6);
  s.drops.length = 0;
  s.enemies[0]!.health = 50;
  assert.equal(destination()?.x, 5, 'respawning enemies do not rewind the completed route');

  const bypass = new Simulation(r);
  bypass.hero.z = -0.5;
  assert.equal(windDestination(bypass.view)?.z, -2, 'the first encounter leads onward past camp');
  bypass.enemies[0]!.health = 0;
  assert.equal(windDestination(bypass.view)?.z, -6, 'an unclaimed satchel does not rewind combat');
  bypass.hero.z = -5;
  assert.equal(windDestination(bypass.view)?.z, -6, 'passing the camp does not guide backward');
});

test('wind follows the chapel journey after either upgrade and returns only with its reward', () => {
  const base = registry().definitions.areas[0]!;
  const ids = [
    'abandoned-orchard',
    'forest-gathering-clearing',
    'ruined-forge',
    'desecrated-chapel',
  ];
  const r = new ContentRegistry({
    ...fixture.definitions,
    initialArea: ids[0]!,
    areas: ids.map((id, i) => ({
      ...base,
      id,
      spawns: [],
      exits: [
        ...(i
          ? [
              {
                ...base.exits[0]!,
                id: 'return',
                destination: ids[i - 1]!,
                entry: 'start',
                marker: { x: -5, z: 0 },
              },
            ]
          : []),
        ...(i < ids.length - 1
          ? [
              {
                ...base.exits[0]!,
                id: i === 0 ? 'depart' : 'forward',
                destination: ids[i + 1]!,
                entry: 'start',
                marker: { x: 5, z: 0 },
              },
            ]
          : []),
      ],
      interactables: [
        interactable({ id: i === 0 ? 'guarded-chest' : 'cache', object: 'cache', z: 2 }),
      ],
    })),
  });
  for (const upgrades of ['sword', 'lantern'] as const)
    for (const id of ids) {
      const session = new GameSession(r, 142, id),
        save = session.captureSave();
      delete save.adventure!.pack;
      save.adventure!.upgrades = { [upgrades]: 1 };
      session.restoreSave(save);
      const outward = session.sim,
        cache = outward.areaDefinition.interactables![0]!;
      assert.deepEqual(windDestination(outward.view), cache);
      outward.claimedObjects.add(cache.id);
      outward.drops.push({
        id: 'cache-reward',
        source: cache.id,
        enemy: false,
        x: 1,
        z: 2,
        rewards: [{ item: 'gold', amount: 1 }],
      });
      assert.deepEqual(windDestination(outward.view), outward.view.drops[0]);
      outward.drops.length = 0;
      assert.deepEqual(
        windDestination(outward.view),
        outward.areaDefinition.exits.find((exit) => exit.id !== 'return')?.marker ??
          outward.areaDefinition.campfires![0],
        'an upgrade alone must not turn the journey home',
      );
      save.adventure!.inventory['vigil-amulet'] = 1;
      session.restoreSave(save);
      const sim = session.sim,
        home =
          sim.areaDefinition.exits.find((e) => e.id === 'return')?.marker ??
          sim.areaDefinition.campfires![0];
      assert.deepEqual(
        windDestination(sim.view),
        home,
        'unclaimed optional caches do not restart the outward journey',
      );
      sim.claimedObjects.add(cache.id);
      sim.drops.push({
        id: 'cache-reward',
        source: cache.id,
        enemy: false,
        x: 1,
        z: 2,
        rewards: [{ item: 'gold', amount: 1 }],
      });
      assert.deepEqual(
        windDestination(sim.view),
        sim.view.drops[0],
        'finish an opened cache before leaving',
      );
      sim.drops.length = 0;
      sim.drops.push({
        id: 'enemy-reward',
        source: 'a',
        enemy: true,
        x: 2,
        z: 1,
        rewards: [{ item: 'gold', amount: 1 }],
      });
      assert.deepEqual(
        windDestination(sim.view),
        home,
        'ordinary enemy coins do not redirect the return',
      );
      sim.hero.health = 0;
      assert.equal(windDestination(sim.view), undefined);
    }
});
