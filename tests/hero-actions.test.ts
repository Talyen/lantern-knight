import { content } from '../src/content/game-content';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../src/core/session';
import { Simulation } from '../src/core/simulation';
import { attackDefinition, tuning } from '../src/content/gameplay';
import { heroActionTiming, heroTimings } from '../src/content/hero-actions';
import { selectAuthoredDirection, AUTHORED_HEADINGS } from '../src/core/camera';
const still = { move: { x: 0, z: 0 }, aim: { x: 1, z: 0 } };
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
  s.step({ ...still, attack: true });
  const heading = s.hero.actionHeading;
  for (let i = 0; i < 8; i++) s.step({ ...still, aim: { x: 0, z: -2 } });
  assert.equal(s.hero.actionHeading, heading);
  assert.equal(s.hero.yaw, Math.PI / 2);
});
test('each authored attack heading damages only during its active phase and completes without chaining', () => {
  for (const kind of ['sweep', 'lunge'] as const)
    for (const heading of AUTHORED_HEADINGS) {
      const s = duel(),
        yaw = (AUTHORED_HEADINGS.indexOf(heading) * Math.PI) / 2;
      Object.assign(s.enemies[0]!, { x: Math.sin(yaw), z: Math.cos(yaw) });
      s.hero.aim = yaw;
      s.startSword(s.hero, kind);
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
        Math.ceil(
          (heroTimings[kind]![heading].holdsMs.reduce((a, b) => a + b, 0) * 60) / 1000 - 1e-8,
        ),
      );
    }
  const narrow = duel();
  Object.assign(narrow.enemies[0]!, { x: Math.cos(0.5), z: Math.sin(0.5) });
  narrow.hero.aim = Math.PI / 2;
  narrow.startSword(narrow.hero, 'lunge');
  for (let i = 0; i < 54; i++) narrow.step(still);
  assert.equal(narrow.enemies[0]!.health, 100);
});
test('alternation survives waiting, dodge and hurt; interruptions cannot complete or damage stale attacks', () => {
  const s = duel();
  s.step({ ...still, attack: true });
  assert.equal(s.hero.nextAttack, 'lunge');
  s.damage(s.enemies[0]!, s.hero, 1);
  for (let i = 0; i < 100; i++) s.step(still);
  s.step({ ...still, dodge: true });
  for (let i = 0; i < 45; i++) s.step(still);
  s.step({ ...still, attack: true });
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
  session.commitTransition(session.prepareTransition('landing'));
  assert.equal(session.sim.hero.nextAttack, 'lunge');
  const buffered = duel();
  const attacks: string[] = [];
  let action = -1;
  for (let tick = 0; tick < 210; tick++) {
    buffered.step({ ...still, attack: [0, 68, 121].includes(tick) });
    if (buffered.hero.state === 'attack' && buffered.hero.action !== action) {
      action = buffered.hero.action;
      attacks.push(buffered.hero.attackKind);
    }
  }
  assert.deepEqual(attacks, ['sweep', 'lunge', 'sweep']);
  assert.equal(buffered.enemies[0]!.health, 22);
  const early = duel();
  for (let tick = 0; tick < 100; tick++) early.step({ ...still, attack: tick === 0 || tick === 2 });
  assert.equal(early.hero.attackKind, 'sweep');
  early.step({ ...still, attack: true });
  assert.equal(early.hero.attackKind, 'lunge');
  const queued = duel();
  queued.startSword(queued.hero, 'sweep');
  queued.hero.age = attackDefinition(queued.hero).total - 3;
  queued.step({ ...still, move: { x: 1, z: 0 }, dodge: true });
  assert.equal(queued.hero.state, 'attack');
});
test('dodge invulnerability and distance are confined to travel cels; lantern pulses once and death completes', () => {
  const s = duel();
  s.enemies[0]!.x = 5;
  s.step({ ...still, move: { x: 1, z: 0 }, dodge: true });
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
  s.step({ ...still, move: { x: 1, z: 1 }, attack: true });
  assert.equal(s.hero.state, 'death');
  assert.equal(s.hero.action, deathAction);
  for (let i = 1; i < 90; i++) assert.equal(s.step(still).reset, undefined);
  assert.equal(s.step(still).reset, 'death');
  assert.equal(heroActionTiming('hit', 'd90').total, 24);
  const alive = duel();
  alive.step({ ...still, ability: true });
  for (let tick = 0; tick < 100; tick++) alive.step({ ...still, ability: true });
  assert.ok(alive.hero.cooldown > 0);
  assert.notEqual(alive.hero.state, 'ability');
});
