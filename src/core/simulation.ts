import { selectAuthoredDirection, type AuthoredHeading } from './camera';
import type { HeroAttackKind } from '../content/hero-actions';
import { tuning, attackDefinition } from '../content/gameplay';
import {
  content,
  ContentRegistry,
  PLAYER_ID,
  spawnActorId,
  contains,
  heightAt,
  supportedPosition,
  type AreaId,
  type ActorId,
  type ActorDefinition,
} from '../content/world';
import type { GameplayEvent, EventDetails } from './events';
export type State = 'idle' | 'walk' | 'attack' | 'dodge' | 'ability' | 'hurt' | 'death';
export type Actor = {
  id: ActorId;
  definition: ActorDefinition;
  kind: 'hero' | 'enemy';
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  yaw: number;
  aim: number;
  state: State;
  age: number;
  action: number;
  health: number;
  cooldown: number;
  dodgeCooldown: number;
  stun: number;
  hitIds: ActorId[];
  attackKind: HeroAttackKind;
  nextAttack: HeroAttackKind;
  actionHeading: AuthoredHeading;
  attackBufferedUntil: number;
  dashBufferedUntil: number;
  dashYaw: number;
};
export type Command = {
  move: { x: number; z: number };
  aim: { x: number; z: number };
  attack?: boolean;
  dodge?: boolean;
  ability?: boolean;
  generation?: number;
};
export type SimEvent = GameplayEvent;
export type StepResult = { events: readonly GameplayEvent[]; transition?: string; reset?: 'death' };
const idleCommand: Command = { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 } };
export class Simulation {
  tick = 0;
  seed: number;
  readonly initialSeed: number;
  actors: Actor[] = [];
  private tickEvents: SimEvent[] = [];
  cleared = false;
  generation: number;
  resetCount = 0;
  completedEncounters = 0;
  engaged = false;
  constructor(
    seed = 142,
    public area: AreaId = 'court',
    generation = 1,
    public readonly registry: ContentRegistry = content,
    entry?: string,
  ) {
    this.initialSeed = seed;
    this.seed = seed;
    this.generation = generation;
    this.populate(entry);
  }
  get events(): readonly SimEvent[] {
    return Object.freeze([...this.tickEvents]);
  }
  get areaDefinition() {
    return this.registry.area(this.area);
  }
  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  populate(entry?: string) {
    const def = this.areaDefinition,
      spawn = def.entries.find((e) => e.id === (entry ?? def.baselineEntry));
    if (!spawn) throw new Error('missing entry');
    this.seed = (this.initialSeed + def.seedOffset) >>> 0;
    this.actors = [this.create(PLAYER_ID, 'hero', spawn.x, spawn.z)];
    for (const p of def.spawns)
      this.actors.push(
        this.create(
          spawnActorId(def.id, p.id),
          'enemy',
          p.x,
          p.z + this.random() * (p.jitterZ ?? 0),
          p.actor,
        ),
      );
    this.cleared = this.enemies.length === 0;
    this.engaged = !def.activation;
  }
  create(
    id: ActorId,
    kind: Actor['kind'],
    x: number,
    z: number,
    definitionId = kind === 'hero'
      ? this.registry.definitions.player
      : this.registry.definitions.actors.find((a) => a.kind === 'enemy')!.id,
  ): Actor {
    const definition = this.registry.actor(definitionId);
    if (definition.kind !== kind) throw new Error('actor kind mismatch');
    const y = heightAt(this.areaDefinition, x, z);
    return {
      id,
      definition,
      kind,
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      yaw: Math.PI / 4,
      aim: Math.PI / 4,
      state: 'idle',
      age: 0,
      action: 0,
      health: definition.maxHealth,
      cooldown: 0,
      dodgeCooldown: 0,
      stun: 0,
      hitIds: [],
      attackKind: 'sweep',
      nextAttack: 'sweep',
      actionHeading: 'd90',
      attackBufferedUntil: -1,
      dashBufferedUntil: -1,
      dashYaw: 0,
    };
  }
  get hero() {
    const hero = this.actors.find((a) => a.id === PLAYER_ID);
    if (!hero) throw new Error('missing player');
    return hero;
  }
  get enemies() {
    return this.actors.filter((a) => a.kind === 'enemy');
  }
  emit(a: Actor, details: EventDetails) {
    const event = Object.freeze({
      key: `game:${this.generation}:${this.tick}:${a.id}:${a.action}:${this.tickEvents.length}`,
      tick: this.tick,
      generation: this.generation,
      actor: a.id,
      action: a.action,
      area: this.area,
      position: Object.freeze([a.x, a.y, a.z]) as readonly [number, number, number],
      direction: a.yaw,
      ...details,
    });
    this.tickEvents.push(event);
    return event;
  }
  accepts(event: Pick<SimEvent, 'generation'>) {
    return event.generation === this.generation;
  }
  start(a: Actor, state: State, yaw = a.aim) {
    a.state = state;
    a.age = 0;
    a.action++;
    a.yaw = yaw;
    a.actionHeading = selectAuthoredDirection(yaw);
    a.hitIds = [];
  }
  startSword(a: Actor, kind = a.nextAttack) {
    a.attackKind = kind;
    a.nextAttack = kind === 'sweep' ? 'lunge' : 'sweep';
    a.attackBufferedUntil = -1;
    this.start(a, 'attack');
  }
  startDash(a: Actor) {
    a.dashBufferedUntil = -1;
    a.attackBufferedUntil = -1;
    this.start(a, 'dodge', a.dashYaw);
    a.dodgeCooldown = tuning.dodge.cooldown;
  }
  move(a: Actor, x: number, z: number) {
    const position = supportedPosition(
      this.areaDefinition,
      { x: a.x + x, z: a.z + z },
      Math.max(0.3, a.definition.radius),
    );
    a.x = position.x;
    a.z = position.z;
    a.y = heightAt(this.areaDefinition, a.x, a.z);
  }
  damage(from: Actor, to: Actor, amount: number, generation = this.generation) {
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      generation !== this.generation ||
      !this.actors.includes(from) ||
      !this.actors.includes(to) ||
      to.health <= 0 ||
      (to.kind === 'hero' &&
        to.state === 'dodge' &&
        to.age >= tuning.dodge.invulnerableStart &&
        to.age < tuning.dodge.invulnerableEnd)
    )
      return;
    if (to.kind === 'enemy') this.engaged = true;
    const actual = Math.min(to.health, amount);
    to.health -= actual;
    this.emit(from, { kind: 'damage', target: to.id, amount: actual });
    to.attackBufferedUntil = -1;
    to.dashBufferedUntil = -1;
    this.start(to, to.health <= 0 ? 'death' : 'hurt', to.yaw);
    if (!to.health) this.emit(to, { kind: 'death' });
  }
  withinArc(from: Actor, to: Actor, range: number, halfAngle: number) {
    const dx = to.x - from.x,
      dz = to.z - from.z,
      d = Math.hypot(dx, dz);
    if (d > range || Math.abs(to.y - from.y) > tuning.maxCombatHeightDifference) return false;
    if (d < 0.001) return true;
    const difference = Math.abs(
      Math.atan2(Math.sin(Math.atan2(dx, dz) - from.yaw), Math.cos(Math.atan2(dx, dz) - from.yaw)),
    );
    return difference <= halfAngle + 1e-10;
  }
  step(command: Command = idleCommand): StepResult {
    this.tick++;
    this.tickEvents = [];
    const h = this.hero;
    if (h.health <= 0 && h.age >= tuning.deathHoldTicks) return { events: [], reset: 'death' };
    if (command.generation !== undefined && command.generation !== this.generation)
      command = {
        move: { x: 0, z: 0 },
        aim: { x: h.x + Math.sin(h.aim), z: h.z + Math.cos(h.aim) },
      };
    for (const a of this.actors) {
      a.px = a.x;
      a.py = a.y;
      a.pz = a.z;
      a.cooldown = Math.max(0, a.cooldown - 1);
      a.dodgeCooldown = Math.max(0, a.dodgeCooldown - 1);
      a.stun = Math.max(0, a.stun - 1);
    }
    if (
      Number.isFinite(command.aim.x) &&
      Number.isFinite(command.aim.z) &&
      Math.hypot(command.aim.x - h.x, command.aim.z - h.z) > 0.001
    )
      h.aim = Math.atan2(command.aim.x - h.x, command.aim.z - h.z);
    const len = Math.hypot(command.move.x, command.move.z),
      mx = len > 1 ? command.move.x / len : command.move.x,
      mz = len > 1 ? command.move.z / len : command.move.z;
    if (h.health > 0) {
      if (command.attack) h.attackBufferedUntil = this.tick + tuning.inputBufferTicks;
      if (command.dodge) {
        h.dashBufferedUntil = this.tick + tuning.dashBufferTicks;
        h.dashYaw = len > 0.01 ? Math.atan2(mx, mz) : h.aim;
      }
      const available = h.state === 'idle' || h.state === 'walk';
      const canDash = available;
      if (canDash && h.dashBufferedUntil >= this.tick && h.dodgeCooldown === 0) this.startDash(h);
      else if (available) {
        if (command.ability && h.cooldown === 0) {
          h.attackBufferedUntil = -1;
          this.start(h, 'ability');
          h.cooldown = tuning.ability.cooldown;
        } else if (h.attackBufferedUntil >= this.tick) {
          this.startSword(h);
        } else {
          h.state = len > 0.01 ? 'walk' : 'idle';
          h.yaw = h.state === 'walk' ? Math.atan2(mx, mz) : h.aim;
          this.move(h, (mx * h.definition.speed) / 60, (mz * h.definition.speed) / 60);
        }
      }
    }
    if (this.areaDefinition.activation && contains(this.areaDefinition.activation, h))
      this.engaged = true;
    for (const a of this.actors) {
      if (a.health <= 0) {
        a.age++;
        continue;
      }
      if (
        a.kind === 'enemy' &&
        this.engaged &&
        h.health > 0 &&
        a.stun === 0 &&
        (a.state === 'idle' || a.state === 'walk')
      ) {
        const dx = h.x - a.x,
          dz = h.z - a.z,
          d = Math.hypot(dx, dz);
        a.aim = Math.atan2(dx, dz);
        if (d <= a.definition.melee.range) this.start(a, 'attack');
        else if (d > 0.001) {
          a.state = 'walk';
          a.yaw = a.aim;
          this.move(a, ((dx / d) * a.definition.speed) / 60, ((dz / d) * a.definition.speed) / 60);
        }
      }
      if (a.kind === 'enemy' && a.stun > 0 && (a.state === 'walk' || a.state === 'idle'))
        a.state = 'idle';
      if (a.state === 'attack') {
        const t = attackDefinition(a);
        if (a.age === t.windup) this.emit(a, { kind: 'strike' });
        if (a.age >= t.windup && a.age < t.activeEnd)
          for (const target of this.actors) {
            if (target.kind === a.kind || target.health <= 0 || a.hitIds.includes(target.id))
              continue;
            if (this.withinArc(a, target, t.range, t.halfAngle)) {
              a.hitIds.push(target.id);
              this.damage(a, target, t.damage);
            }
          }
        if (a.age >= t.total - 1) this.start(a, 'idle');
      } else if (a.state === 'dodge') {
        if (a.age >= tuning.dodge.travelStart && a.age < tuning.dodge.travelEnd)
          this.move(
            a,
            (Math.sin(a.yaw) * tuning.dodge.speed) / 60,
            (Math.cos(a.yaw) * tuning.dodge.speed) / 60,
          );
        if (a.age >= tuning.dodge.total - 1) this.start(a, 'idle');
      } else if (a.state === 'ability') {
        if (a.age === tuning.ability.windup) {
          this.emit(a, { kind: 'flare' });
          for (const target of this.actors)
            if (
              target.kind === 'enemy' &&
              target.health > 0 &&
              this.withinArc(a, target, tuning.ability.range, tuning.ability.halfAngle)
            ) {
              this.damage(a, target, tuning.ability.damage);
              if (target.health > 0) {
                target.stun = tuning.ability.stun;
                this.emit(a, { kind: 'stagger', target: target.id, duration: tuning.ability.stun });
              }
              a.hitIds.push(target.id);
            }
        }
        if (a.age >= tuning.ability.total - 1) this.start(a, 'idle');
      } else if (
        a.state === 'hurt' &&
        a.age >= (a.kind === 'hero' ? tuning.hurt.total : tuning.enemyHurt.total) - 1
      )
        this.start(a, 'idle', a.yaw);
      a.age++;
    }
    for (let i = 0; i < this.actors.length; i++)
      for (let j = i + 1; j < this.actors.length; j++) {
        const a = this.actors[i]!,
          b = this.actors[j]!;
        if (a.health <= 0 || b.health <= 0) continue;
        const dx = b.x - a.x,
          dz = b.z - a.z,
          d = Math.hypot(dx, dz),
          r = a.definition.radius + b.definition.radius;
        if (d < r && d > 0.001) {
          const delta = (r - d) / 2;
          this.move(a, (-dx / d) * delta, (-dz / d) * delta);
          this.move(b, (dx / d) * delta, (dz / d) * delta);
        }
      }
    const wasCleared = this.cleared;
    this.cleared = this.enemies.every((a) => a.health <= 0);
    if (this.enemies.length && this.cleared && !wasCleared) {
      this.completedEncounters++;
      this.emit(h, { kind: 'room-clear' });
    }
    const exit =
      h.health > 0
        ? this.areaDefinition.exits.find(
            (e) => (!e.requiresClear || this.cleared) && contains(e.trigger, h),
          )
        : undefined;
    return {
      events: Object.freeze([...this.tickEvents]),
      ...(exit ? { transition: exit.id } : {}),
    };
  }
}
export const maximumFrameMs = 100;
export class FixedClock {
  accumulator = 0;
  droppedMs = 0;
  readonly stepMs = 1000 / 60;
  advance(ms: number, step: () => void | boolean) {
    const bounded = Math.min(Math.max(ms, 0), maximumFrameMs);
    this.droppedMs += Math.max(0, ms - bounded);
    this.accumulator += bounded;
    let steps = 0;
    while (this.accumulator + 1e-8 >= this.stepMs && steps < 6) {
      const keepGoing = step();
      this.accumulator -= this.stepMs;
      steps++;
      if (keepGoing === false) {
        this.accumulator = 0;
        break;
      }
    }
    return Math.max(0, this.accumulator / this.stepMs);
  }
  reset() {
    this.accumulator = 0;
  }
}
