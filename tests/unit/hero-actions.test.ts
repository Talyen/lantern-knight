import { content, contentDefinitions } from '../fixtures/content';
import { ContentRegistry } from '../../src/content/world';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../../src/core/session';
import { Simulation } from '../../src/core/simulation';
import { attackDefinition, tuning } from '../../src/content/gameplay';
import { heroActionTiming, heroTimings } from '../../src/content/hero-actions';
import { selectAuthoredDirection, AUTHORED_HEADINGS } from '../../src/content/headings';
const still = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
test('enemies stop their walking pose when death removes their pursuit target', () => {
  const s = new Simulation(content);
  Object.assign(s.hero, { x: 0, z: 0 });
  Object.assign(s.enemies[0]!, { x: 3, z: 0 });
  s.engaged = true;
  s.step(still);
  assert.equal(s.enemies[0]!.state, 'walk');
  s.damage(s.enemies[0]!, s.hero, 1000);
  s.step(still);
  assert.equal(s.enemies[0]!.state, 'idle');
  assert.equal(
    s.navigationDebug(false).routes.some((route) => route.id === s.enemies[0]!.id),
    false,
  );
});
test('enemy death retires manual and automatic movement routes', () => {
  for (const manual of [false, true]) {
    const s = new Simulation(content),
      enemy = s.enemies[0]!;
    s.engaged = true;
    if (manual) s.setMovementTarget(enemy.id, { x: 2, z: 2 });
    s.step(still);
    assert.ok(s.navigationDebug(false).routes.some((route) => route.id === enemy.id));
    s.damage(s.hero, enemy, enemy.health);
    assert.equal(
      s.navigationDebug(false).routes.some((route) => route.id === enemy.id),
      false,
    );
  }
});
test('directional input during an attack cancels the previous movement destination', () => {
  const s = new Simulation(content);
  s.setMovementTarget(s.hero.id, { x: 2, z: 6 });
  s.startSword(s.hero);
  s.step({ ...still, move: { x: -1, z: 0 } });
  assert.equal(s.navigationDebug(false).routes.length, 0);
  for (let i = 0; i < 80; i++) s.step(still);
  assert.equal(s.hero.x, 0);
});
function duel() {
  const s = new Simulation(content, 142, content.definitions.initialArea, 1);
  s.actors = [s.hero, s.enemies[0]!];
  Object.assign(s.hero, { x: 0, z: 0 });
  Object.assign(s.enemies[0]!, { x: 1, z: 0, health: 100, stun: 10000 });
  return s;
}
test('authored heading ties and hysteresis preserve action headings while aim changes', () => {
  assert.equal(selectAuthoredDirection(Math.PI / 4), 'd90');
  assert.equal(selectAuthoredDirection(Math.PI / 4 - 0.01, 'd90'), 'd90');
  assert.equal(selectAuthoredDirection(-Math.PI / 2), 'd270');
  const s = duel();
  s.step({ ...still, actions: ['sword'] });
  const heading = s.hero.actionHeading;
  for (let i = 0; i < 8; i++) s.step({ ...still, aim: { x: 0, z: -2 } });
  assert.equal(s.hero.actionHeading, heading);
  assert.equal(s.hero.yaw, Math.PI / 2);
});
test('each attack heading damages only during its active phase and completes without chaining', () => {
  for (const kind of ['sweep', 'lunge'] as const)
    for (const heading of AUTHORED_HEADINGS) {
      const s = duel(),
        yaw = (AUTHORED_HEADINGS.indexOf(heading) * Math.PI) / 2;
      Object.assign(s.enemies[0]!, { x: Math.sin(yaw), z: Math.cos(yaw) });
      s.hero.aim = yaw;
      s.startSword(s.hero, kind);
      assert.equal(s.hero.actionHeading, heading);
      const spec = attackDefinition(s.hero),
        hits: number[] = [];
      for (let i = 0; i < spec.total; i++) {
        s.step({ move: { x: 0, z: 0 }, aim: { x: Math.sin(yaw), z: Math.cos(yaw) } });
        if (s.events.some((e) => e.kind === 'damage')) {
          hits.push(i);
          assert.equal(s.hero.hitIds.length, 1);
        }
      }
      assert.deepEqual(hits, [spec.windup]);
      assert.equal(s.hero.state, 'idle');
      assert.equal(s.enemies[0]!.health, 74);

      assert.equal(
        spec.total,
        kind === 'sweep'
          ? 36
          : Math.ceil(
              (heroTimings[kind]![heading].holdsMs.reduce((a, b) => a + b, 0) * 60) / 1000 - 1e-8,
            ),
      );
    }
  for (const offset of [-1e-7, 0, 1e-7]) {
    const narrow = duel();
    narrow.hero.aim = Math.PI / 2;
    narrow.startSword(narrow.hero, 'lunge');
    const angle = attackDefinition(narrow.hero).halfAngle + offset;
    Object.assign(narrow.enemies[0]!, { x: Math.cos(angle), z: Math.sin(angle) });
    for (let i = 0; i < 54; i++) narrow.step(still);
    assert.equal(narrow.enemies[0]!.health, offset > 0 ? 100 : 74);
  }
});
test('alternation survives waiting, dodge and hurt; interruptions cannot complete or damage stale attacks', () => {
  const s = duel();
  s.step({ ...still, actions: ['sword'] });
  assert.equal(s.hero.nextAttack, 'lunge');
  s.damage(s.enemies[0]!, s.hero, 1);
  for (let i = 0; i < 100; i++) s.step(still);
  s.step({ ...still, actions: ['dodge'] });
  for (let i = 0; i < 45; i++) s.step(still);
  s.step({ ...still, actions: ['sword'] });
  assert.equal(s.hero.attackKind, 'lunge');
  assert.equal(s.hero.nextAttack, 'sweep');
  assert.equal(
    new Simulation(content, 142, content.definitions.initialArea, 1).hero.nextAttack,
    'sweep',
  );
  const session = new GameSession(content);
  session.sim.hero.nextAttack = 'lunge';
  session.sim.enemies.forEach((a) => (a.health = 0));
  session.sim.cleared = true;
  session.commitRoom(session.prepareTransition('landing'));
  assert.equal(session.sim.hero.nextAttack, 'lunge');
  const buffered = duel();
  const attacks: string[] = [];
  let action = -1;
  for (let tick = 0; tick < 210; tick++) {
    buffered.step({ ...still, actions: [0, 68, 121].includes(tick) ? ['sword'] : [] });
    if (buffered.hero.state === 'attack' && buffered.hero.action !== action) {
      action = buffered.hero.action;
      attacks.push(buffered.hero.attackKind);
    }
  }
  assert.deepEqual(attacks, ['sweep', 'lunge', 'sweep']);
  assert.equal(buffered.enemies[0]!.health, 22);
  const early = duel();
  for (let tick = 0; tick < 100; tick++)
    early.step({ ...still, actions: tick === 0 || tick === 2 ? ['sword'] : [] });
  assert.equal(early.hero.attackKind, 'lunge');
  early.step({ ...still, actions: ['sword'] });
  assert.equal(early.hero.attackKind, 'sweep');
  const queued = duel();
  queued.startSword(queued.hero, 'sweep');
  queued.hero.age = attackDefinition(queued.hero).total - 3;
  queued.step({ ...still, move: { x: 1, z: 0 }, actions: ['dodge'] });
  assert.equal(queued.hero.state, 'dodge');
});
test('dodge invulnerability and distance are confined to travel cels; lantern pulses once and death completes', () => {
  const s = duel();
  s.enemies[0]!.x = 5;
  s.step({ ...still, move: { x: 1, z: 0 }, actions: ['dodge'] });
  const start = s.hero.x;
  for (let i = 1; i < tuning.dodge.travelStart; i++) s.step(still);
  assert.equal(s.hero.x, start);
  s.hero.age = tuning.dodge.invulnerableStart;
  s.damage(s.enemies[0]!, s.hero, 10);
  assert.equal(s.hero.health, 100);
  for (let i = tuning.dodge.travelStart; i < tuning.dodge.total; i++) s.step(still);
  assert.ok(Math.abs(s.hero.x - start - 2.1) < 1e-9);
  s.start(s.hero, 'dodge');
  s.hero.age = tuning.dodge.invulnerableEnd;
  s.damage(s.enemies[0]!, s.hero, 10);
  assert.equal(s.hero.health, 90);
  s.start(s.hero, 'ability');
  let pulses = 0;
  for (let i = 0; i < tuning.ability.total; i++) {
    s.step(still);
    pulses += s.events.filter((e) => e.kind === 'flare').length;
  }
  assert.equal(pulses, 1);
  assert.equal(s.hero.state, 'idle');
  s.start(s.hero, 'ability');
  const interruptedAction = s.hero.action;
  s.damage(s.enemies[0]!, s.hero, 1000);
  assert.ok(s.hero.action > interruptedAction);
  const deathAction = s.hero.action;
  s.step({ ...still, move: { x: 1, z: 1 }, actions: ['sword'] });
  assert.equal(s.hero.state, 'death');
  assert.equal(s.hero.action, deathAction);
  for (let i = 1; i < 90; i++) assert.equal(s.step(still).reset, undefined);
  assert.equal(s.step(still).reset, 'death');
  assert.equal(heroActionTiming('hit', 'd90').total, 24);
  const alive = duel();
  alive.step({ ...still, actions: ['lantern'] });
  for (let tick = 0; tick < 100; tick++) alive.step({ ...still, actions: ['lantern'] });
  assert.ok(alive.hero.cooldown > 0);
  assert.notEqual(alive.hero.state, 'ability');
});

test('enemy strikes use the same dodge invulnerability tick regardless of actor iteration order', () => {
  for (const age of [
    tuning.dodge.invulnerableStart - 1,
    tuning.dodge.invulnerableStart,
    tuning.dodge.invulnerableEnd - 1,
    tuning.dodge.invulnerableEnd,
  ]) {
    for (const reverse of [false, true]) {
      const s = duel(),
        enemy = s.enemies[0]!;
      Object.assign(enemy, { x: 0, z: 1.1, stun: 0, aim: Math.PI });
      s.start(enemy, 'attack');
      enemy.age = enemy.definition.melee.windup;
      s.start(s.hero, 'dodge', Math.PI / 2);
      s.hero.age = age;
      if (reverse) s.actors.reverse();
      s.step(still);
      const invulnerable =
        age >= tuning.dodge.invulnerableStart && age < tuning.dodge.invulnerableEnd;
      assert.equal(s.hero.health, invulnerable ? 100 : 92, `age=${age}, reverse=${reverse}`);
    }
  }
});

test('sweep and lunge apply the accepted hero melee damage', () => {
  const definitions = structuredClone(contentDefinitions);
  definitions.actors.find((a) => a.kind === 'hero')!.melee.damage = 7;
  for (const kind of ['sweep', 'lunge'] as const) {
    const s = new Simulation(new ContentRegistry(definitions));
    Object.assign(s.hero, { x: 0, z: 0, aim: Math.PI / 2 });
    Object.assign(s.enemies[0]!, { x: 1, z: 0, stun: 10000 });
    s.startSword(s.hero, kind);
    s.hero.age = attackDefinition(s.hero).windup;
    s.step(still);
    assert.equal(s.enemies[0]!.health, 43);
  }
});

test('poise preserves a physical-hit windup, while lantern stagger and death interrupt it', () => {
  const registry = new ContentRegistry({
    ...contentDefinitions,
    actors: contentDefinitions.actors.map((a) =>
      a.kind === 'enemy' ? { ...a, poise: true, maxHealth: 200 } : a,
    ),
  });
  const s = new Simulation(registry);
  const enemy = s.enemies[0]!;
  Object.assign(s.hero, { x: 0, z: 0 });
  Object.assign(enemy, { x: 1, z: 0 });
  s.startSword(enemy);
  enemy.age = 20;
  const action = enemy.action;
  s.damage(s.hero, enemy, 26);
  assert.equal(enemy.health, 174);
  assert.equal(enemy.state, 'attack');
  assert.equal(enemy.age, 20);
  assert.equal(enemy.action, action);
  s.step({ ...still, actions: ['lantern'] });
  for (let i = 0; i < tuning.ability.windup; i++) s.step(still);
  assert.equal(enemy.state, 'hurt');
  assert.ok(enemy.stun > 0);
  assert.ok(enemy.burn);
  s.startSword(enemy);
  enemy.age = 20;
  s.damage(s.hero, enemy, 1000);
  assert.equal(enemy.state, 'death');
  assert.equal(enemy.health, 0);
});
