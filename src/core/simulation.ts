import { simulationView } from './simulation-view';
import {
  Navigation,
  moveSupported,
  effectiveRadius,
  clearSegment,
  type RouteResult,
} from './navigation';
import type { Point } from '../content/world';
import type { ContentSnapshot } from '../content/snapshot';
import { selectAuthoredDirection, type AuthoredHeading } from './camera';
import type { HeroAttackKind } from '../content/hero-actions';
import type { SweepTiming, SweepRecovery } from '../content/sweep-timing';
import { tuning, attackDefinition } from '../content/gameplay';
import {
  ContentRegistry,
  PLAYER_ID,
  spawnActorId,
  contains,
  heightAt,
  type AreaId,
  type ActorId,
  type ActorDefinition,
} from '../content/world';
import type { GameplayEvent, EventDetails } from './events';
export type State = 'idle' | 'walk' | 'attack' | 'dodge' | 'ability' | 'hurt' | 'death';
export type Actor = {
  id: ActorId;
  definition: ContentSnapshot<ActorDefinition>;
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
  sweepTiming?: SweepTiming;
  sweepRecovery?: SweepRecovery;
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
  readonly #view = simulationView(this);
  get view() {
    return this.#view;
  }
  movementPreview = false;
  private navigationArea?: object;
  private navigation?: Navigation;
  private movementTargets = new Map<
    string,
    { target: Point; route: RouteResult; nextPlan: number; explicit: boolean }
  >();
  setMovementTarget(id: string, target: Point | null) {
    if (!this.actors.some((a) => a.id === id)) throw new Error('Unknown movement actor');
    if (!target) {
      this.movementTargets.delete(id);
      return;
    }
    this.movementTargets.set(id, {
      target: { ...target },
      route: this.navigator.route(
        this.actors.find((a) => a.id === id)!,
        target,
        effectiveRadius(this.actors.find((a) => a.id === id)!.definition.radius),
      ),
      nextPlan: this.tick + 15,
      explicit: true,
    });
  }
  private get navigator() {
    if (this.navigationArea !== this.areaDefinition) {
      this.navigationArea = this.areaDefinition;
      this.navigation = new Navigation(this.areaDefinition);
      this.movementTargets.clear();
    }
    return this.navigation!;
  }
  navigationDebug(includeCells = true) {
    // Diagnostics must not initialize the gameplay navigator or clear movement targets.
    return {
      routes: [...this.movementTargets].map(([id, p]) => ({
        id,
        target: { ...p.target },
        status: p.route.status,
        points: p.route.points.map((v) => ({ ...v })),
      })),
      cells:
        includeCells && this.navigationArea === this.areaDefinition
          ? this.navigation!.debugCells(effectiveRadius(this.hero.definition.radius))
          : [],
    };
  }
  private pursuitRoute(a: Actor, target: Point): RouteResult {
    const radius = effectiveRadius(a.definition.radius);
    const direct = this.navigator.route(a, target, radius);
    if (direct.status === 'ready' || target !== this.hero) return direct;
    // A larger enemy may not fit at the hero's feet. Find a reachable melee
    // position with clear contact rather than treating the hero as unreachable.
    const distance = a.definition.melee.range * 0.8;
    const candidates = Array.from({ length: 16 }, (_, i) => ({
      x: target.x + Math.cos((i * Math.PI) / 8) * distance,
      z: target.z + Math.sin((i * Math.PI) / 8) * distance,
    })).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
    for (const point of candidates) {
      if (!clearSegment(this.areaDefinition, point, target, 0.001)) continue;
      const route = this.navigator.route(a, point, radius);
      if (route.status === 'ready') return route;
    }
    return direct;
  }
  private follow(a: Actor, target?: Point) {
    void this.navigator;
    let plan = this.movementTargets.get(a.id);
    if (!plan) {
      if (!target) return false;
      plan = {
        target: { ...target },
        route: this.pursuitRoute(a, target),
        nextPlan: this.tick + 15,
        explicit: false,
      };
      this.movementTargets.set(a.id, plan);
    }
    if (target && !plan.explicit && this.tick >= plan.nextPlan) {
      plan.target = { ...target };
      plan.route = this.pursuitRoute(a, target);
      plan.nextPlan = this.tick + 15;
    }
    if (plan.route.status === 'unreachable') {
      a.state = 'idle';
      return false;
    }
    const step = a.definition.speed / 60;
    while (
      plan.route.points.length &&
      Math.hypot(plan.route.points[0]!.x - a.x, plan.route.points[0]!.z - a.z) < 1e-6
    )
      plan.route.points.shift();
    const p = plan.route.points[0];
    if (!p) {
      a.state = 'idle';
      return false;
    }
    const dx = p.x - a.x,
      dz = p.z - a.z,
      d = Math.hypot(dx, dz);
    a.yaw = Math.atan2(dx, dz);
    a.state = 'walk';
    this.move(a, (dx / d) * Math.min(step, d), (dz / d) * Math.min(step, d));
    return true;
  }
  tick = 0;
  seed: number;
  readonly initialSeed: number;
  actors: Actor[] = [];
  collectedPickups = new Set<string>();
  private tickEvents: SimEvent[] = [];
  cleared = false;
  generation: number;
  resetCount = 0;
  completedEncounters = 0;
  engaged = false;
  constructor(
    public readonly registry: ContentRegistry,
    seed = 142,
    public area: AreaId = registry.definitions.initialArea,
    generation = 1,
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
    this.movementTargets.clear();
    this.collectedPickups.clear();
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
    const position = moveSupported(
      this.areaDefinition,
      a,
      { x, z },
      effectiveRadius(a.definition.radius),
    );
    a.x = position.x;
    a.z = position.z;
    a.y = heightAt(this.areaDefinition, a.x, a.z);
  }
  damage(from: Actor, to: Actor, amount: number, generation = this.generation) {
    if (
      this.movementPreview ||
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
      if (command.attack && !this.movementPreview)
        h.attackBufferedUntil = this.tick + tuning.inputBufferTicks;
      if (command.dodge) {
        h.dashBufferedUntil = this.tick + tuning.dashBufferTicks;
        h.dashYaw = len > 0.01 ? Math.atan2(mx, mz) : h.aim;
      }
      const available = h.state === 'idle' || h.state === 'walk';
      const canDash = available;
      if (canDash && h.dashBufferedUntil >= this.tick && h.dodgeCooldown === 0) this.startDash(h);
      else if (available) {
        if (command.ability && !this.movementPreview && h.cooldown === 0) {
          h.attackBufferedUntil = -1;
          this.start(h, 'ability');
          h.cooldown = tuning.ability.cooldown;
        } else if (h.attackBufferedUntil >= this.tick) {
          this.startSword(h);
        } else {
          if (len > 0.01) this.movementTargets.delete(h.id);
          if (len <= 0.01 && this.movementTargets.has(h.id)) {
            this.follow(h);
          } else {
            h.state = len > 0.01 ? 'walk' : 'idle';
            h.yaw = h.state === 'walk' ? Math.atan2(mx, mz) : h.aim;
            this.move(h, (mx * h.definition.speed) / 60, (mz * h.definition.speed) / 60);
          }
        }
      }
    }
    if (this.areaDefinition.activation && contains(this.areaDefinition.activation, h))
      this.engaged = true;
    for (const a of this.actors) {
      if (a.health <= 0) continue;
      if (
        a.kind === 'enemy' &&
        (this.engaged || this.movementPreview) &&
        h.health > 0 &&
        a.stun === 0 &&
        (a.state === 'idle' || a.state === 'walk')
      ) {
        const dx = h.x - a.x,
          dz = h.z - a.z,
          d = Math.hypot(dx, dz);
        a.aim = Math.atan2(dx, dz);
        const contact =
          Math.abs(a.y - h.y) <= tuning.maxCombatHeightDifference &&
          clearSegment(this.areaDefinition, a, h, 0.001);
        const explicit = this.movementTargets.get(a.id)?.explicit;
        if (!explicit && d <= a.definition.melee.range && contact) {
          a.state = 'idle';
          if (!this.movementPreview) this.start(a, 'attack');
        } else this.follow(a, h);
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
            if (
              this.withinArc(a, target, t.range, t.halfAngle) &&
              clearSegment(this.areaDefinition, a, target, 0.001)
            ) {
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
              this.withinArc(a, target, tuning.ability.range, tuning.ability.halfAngle) &&
              clearSegment(this.areaDefinition, a, target, 0.001)
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
    }
    // Every actor observes the same action tick during combat, including dodge protection.
    for (const a of this.actors) a.age++;
    for (let i = 0; i < this.actors.length; i++)
      for (let j = i + 1; j < this.actors.length; j++) {
        const a = this.actors[i]!,
          b = this.actors[j]!;
        if (
          a.health <= 0 ||
          b.health <= 0 ||
          Math.abs(a.y - b.y) > tuning.maxCombatHeightDifference
        )
          continue;
        const dx = b.x - a.x,
          dz = b.z - a.z,
          d = Math.hypot(dx, dz),
          r = a.definition.radius + b.definition.radius;
        if (d < r) {
          // Coincident authored spawns need a stable separation direction too.
          const nx = d > 1e-8 ? dx / d : 1,
            nz = d > 1e-8 ? dz / d : 0,
            delta = (r - d) / 2;
          this.move(a, -nx * delta, -nz * delta);
          this.move(b, nx * delta, nz * delta);
        }
      }
    const wasCleared = this.cleared;
    if (h.health > 0)
      for (const pickup of this.areaDefinition.pickups ?? []) {
        if (
          this.collectedPickups.has(pickup.id) ||
          Math.hypot(h.x - pickup.x, h.z - pickup.z) > pickup.radius ||
          Math.abs(h.y - heightAt(this.areaDefinition, pickup.x, pickup.z)) >
            tuning.maxCombatHeightDifference ||
          !clearSegment(this.areaDefinition, h, pickup, 0.001) ||
          h.health >= this.registry.actor(this.registry.definitions.player).maxHealth
        )
          continue;
        const amount = Math.min(
          pickup.amount,
          this.registry.actor(this.registry.definitions.player).maxHealth - h.health,
        );
        h.health += amount;
        this.collectedPickups.add(pickup.id);
        this.emit(h, { kind: 'pickup', pickup: pickup.id, amount });
      }
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
