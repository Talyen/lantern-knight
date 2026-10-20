import { scaledDamage } from '../content/progression';
import { tuning, attackDefinition } from '../content/gameplay';
import { heightAt, heightBreakpoints, type AreaDefinition, type Point } from '../content/world';
import type { Actor, State } from './actor';
import type { EventDetails, DamageType, DamagePhase } from './events';
import { selectAuthoredDirection } from '../content/headings';
import { clearSegment, effectiveRadius } from '../content/collision';
import type { AcceptedCommand, HeroAction } from './command';
import { burningSwordBonus } from '../content/items';
import { lanePoint, nearestLanePoint, type RibLane } from '../content/rib-lane';
import { isSupportedPosition } from '../content/collision';
import type { Equipment } from '../content/items';

const actionLabel = (kind: HeroAction) =>
  kind === 'sword' ? 'Sword' : kind === 'lantern' ? 'Lantern' : 'Dodge';

// Borrow current actors and room capabilities; combat cannot replace the room,
// award inventory, plan routes, or persist state. Simulation owns those outcomes.
interface CombatWorld {
  actors(): readonly Actor[];
  movementPreview(): boolean;
  damagePercent(type: DamageType): number;
  equipment(): Readonly<Equipment>;
  safePoint(point: Point): boolean;
  emit(actor: Actor, details: EventDetails): unknown;
  move(actor: Actor, x: number, z: number): void;
  enemyHit(actor: Actor): void;
  enemyDefeated(actor: Actor): void;
  breakObject(id: string): void;
}

// One room-local owner for action admission, interruption, damage and recovery.
// Actor clocks remain on actors; the fixed-step coordinator advances them once,
// after every actor has resolved combat against the same action tick.
export class CombatActions {
  // Displacement belongs to this combat owner and the struck actor instance.
  // Checkpoints retain the resulting position, never an unfinished impulse.
  private readonly recoils = new WeakMap<Actor, { x: number; z: number; ticks: number }>();
  private readonly lanes = new Map<Actor, Omit<RibLane, 'age'>>();
  private static readonly noLanes: readonly RibLane[] = Object.freeze([]);
  get ribLanes(): readonly RibLane[] {
    if (!this.lanes.size) return CombatActions.noLanes;
    return Object.freeze(
      [...this.lanes]
        .filter(
          ([source]) =>
            source.health > 0 &&
            source.state === 'attack' &&
            this.world.actors().includes(source) &&
            this.world.actors().some((a) => a.kind === 'hero' && a.health > 0) &&
            !this.world.movementPreview(),
        )
        .map(([source, lane]) => Object.freeze({ ...lane, age: source.age })),
    );
  }
  clear() {
    this.lanes.clear();
  }
  cancelSpells() {
    for (const source of this.lanes.keys()) this.start(source, 'idle', source.yaw);
  }
  beginTick() {
    const actors = this.world.actors();
    if (!actors.some((a) => a.kind === 'hero' && a.health > 0)) this.lanes.clear();
    for (const [source] of this.lanes)
      if (!actors.includes(source) || source.health <= 0 || source.state !== 'attack')
        this.lanes.delete(source);
  }
  constructor(
    private readonly area: AreaDefinition,
    private readonly world: CombatWorld,
  ) {}
  start(a: Actor, state: State, yaw = state === 'idle' && a.kind === 'hero' ? a.yaw : a.aim) {
    this.lanes.delete(a);
    if (a.kind === 'hero' && state === 'death') this.lanes.clear();
    if (state === 'attack' && a.definition.attack.kind === 'rib-lane') {
      const target = this.world.actors().find((actor) => actor.kind === 'hero');
      const attack = a.definition.attack;
      if (!target || target.health <= 0 || a.cooldown > 0) return;
      const lane = Object.freeze({
        id: `${a.id}:${a.action + 1}`,
        source: a.id,
        x: target.x,
        z: target.z,
        y: target.y,
        length: attack.length,
        width: attack.width,
        windup: attack.windup,
        total: attack.total,
      });
      if (!this.laneAllowed(a, lane)) return;
      this.lanes.set(a, lane);
      a.cooldown = attack.cooldown;
    }
    a.state = state;
    a.age = 0;
    a.action++;
    a.yaw = yaw;
    a.actionHeading = selectAuthoredDirection(yaw);
    a.hitIds = [];
  }
  startSword(a: Actor, kind = a.nextAttack, yaw = a.aim) {
    a.attackKind = kind;
    a.nextAttack = kind === 'sweep' ? 'lunge' : 'sweep';
    a.pendingAction = undefined;
    this.start(a, 'attack', yaw);
  }
  private startDash(a: Actor) {
    const yaw = a.pendingAction?.yaw ?? a.aim;
    a.pendingAction = undefined;
    this.start(a, 'dodge', yaw);
    a.dodgeCooldown = tuning.dodge.cooldown;
    this.world.emit(a, { kind: 'dodge' });
  }
  damage(
    from: Actor,
    to: Actor,
    amount: number,
    damageType: DamageType = 'physical',
    phase: DamagePhase = 'direct',
  ) {
    if (
      this.world.movementPreview() ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      to.health <= 0 ||
      (to.kind === 'hero' &&
        to.state === 'dodge' &&
        to.age >= tuning.dodge.invulnerableStart &&
        to.age < tuning.dodge.invulnerableEnd)
    )
      return;
    if (to.kind === 'enemy') this.world.enemyHit(to);
    const resolved =
      from.kind === 'hero'
        ? scaledDamage(
            amount,
            this.world.damagePercent(damageType) *
              (damageType === 'physical' && phase === 'direct' && from.state === 'attack' && to.burn
                ? 1 + burningSwordBonus(this.world.equipment()) / 100
                : 1),
          )
        : amount;
    const actual = Math.min(to.health, resolved);
    to.health -= actual;
    this.world.emit(from, { kind: 'damage', target: to.id, amount: actual, damageType, phase });
    if (!to.health || (phase === 'direct' && (damageType === 'burn' || !to.definition.poise))) {
      to.pendingAction = undefined;
      this.start(to, to.health <= 0 ? 'death' : 'hurt', to.yaw);
    }
    if (!to.health) {
      this.recoils.delete(to);
      to.burn = undefined;
      this.world.emit(to, { kind: 'death' });
      if (to.kind === 'enemy') this.world.enemyDefeated(to);
    }
  }
  private withinArc(
    from: Pick<Actor, 'x' | 'y' | 'z' | 'yaw'>,
    to: Point & { y: number },
    range: number,
    halfAngle: number,
    sy?: number,
    cy?: number,
  ) {
    const dx = to.x - from.x,
      dz = to.z - from.z,
      dSquared = dx * dx + dz * dz;
    if (dSquared > range * range || Math.abs(to.y - from.y) > tuning.maxCombatHeightDifference)
      return false;
    if (dSquared < 1e-6 || halfAngle === Math.PI) return true;
    const s = sy ?? Math.sin(from.yaw),
      c = cy ?? Math.cos(from.yaw);
    const d = Math.sqrt(dSquared);
    return dx * s + dz * c >= d * Math.cos(halfAngle + 1e-10);
  }
  private laneAllowed(source: Actor, lane: Omit<RibLane, 'age'>) {
    if (
      Math.abs(source.y - lane.y) > tuning.maxCombatHeightDifference ||
      !clearSegment(this.area, source, lane, 0.001)
    )
      return false;
    const corners = [-1, 1].flatMap((along) =>
      [-1, 1].map((across) =>
        lanePoint(lane, (along * lane.length) / 2, (across * lane.width) / 2),
      ),
    );
    const start = lanePoint(lane, -lane.length / 2, 0),
      end = lanePoint(lane, lane.length / 2, 0);
    if (!clearSegment(this.area, start, end, lane.width / 2)) return false;
    for (const point of [lane, start, end, ...corners])
      if (
        !isSupportedPosition(this.area, point, 0.001) ||
        Math.abs(heightAt(this.area, point.x, point.z) - lane.y) > 0.01 ||
        this.world.safePoint(point)
      )
        return false;
    // A stair/terrace can cross the interior while all four corners remain flat.
    for (let i = 0; i < corners.length; i++) {
      const from = corners[i]!,
        to = corners[(i + 1) % corners.length]!;
      for (const t of heightBreakpoints(this.area, from, to, [lane.y])) {
        const p = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
        if (Math.abs(heightAt(this.area, p.x, p.z) - lane.y) > 0.01) return false;
      }
    }
    for (const fire of this.area.campfires ?? [])
      if (this.world.safePoint(nearestLanePoint(lane, fire))) return false;
    return true;
  }
  private advanceLane(a: Actor) {
    const lane = this.lanes.get(a),
      attack = a.definition.attack;
    const hero = this.world.actors().find((actor) => actor.kind === 'hero');
    if (!lane || !hero || hero.health <= 0 || this.world.safePoint(hero)) {
      this.start(a, 'idle');
      return;
    }
    if (a.age >= attack.windup && a.age < attack.activeEnd && !a.hitIds.includes(hero.id)) {
      const nearest = nearestLanePoint(lane, hero);
      if (
        Math.hypot(hero.x - nearest.x, hero.z - nearest.z) <=
          effectiveRadius(hero.definition.radius) &&
        Math.abs(hero.y - lane.y) <= tuning.maxCombatHeightDifference &&
        clearSegment(this.area, lane, hero, 0.001)
      ) {
        // One contact attempt, including a successful invulnerable dodge.
        a.hitIds.push(hero.id);
        this.damage(a, hero, attack.damage);
      }
    }
    if (a.age >= attack.total - 1) this.start(a, 'idle');
  }
  private cancellable(h: Actor) {
    switch (h.state) {
      case 'idle':
      case 'walk':
        return true;
      case 'attack':
        return h.age >= attackDefinition(h).activeEnd;
      // The pulse tick must be advanced before admission can replace casting.
      case 'ability':
        return h.age > tuning.ability.windup;
      case 'dodge':
        return h.age >= Math.max(tuning.dodge.travelEnd, tuning.dodge.invulnerableEnd);
      default:
        return false;
    }
  }
  // True only when locomotion may run instead of an action this tick.
  admitHero(h: Actor, command: Pick<AcceptedCommand, 'actions'>, movementYaw?: number): boolean {
    const queued = h.pendingAction;
    if (this.world.movementPreview() && queued && queued.kind !== 'dodge') {
      this.world.emit(h, {
        kind: 'action-unavailable',
        reason: `${actionLabel(queued.kind)} unavailable while previewing movement`,
      });
      h.pendingAction = undefined;
    }
    for (const kind of command.actions) {
      if (this.world.movementPreview() && kind !== 'dodge') {
        this.world.emit(h, {
          kind: 'action-unavailable',
          reason: `${actionLabel(kind)} unavailable while previewing movement`,
        });
        continue;
      }
      const cooldown = kind === 'lantern' ? h.cooldown : kind === 'dodge' ? h.dodgeCooldown : 0;
      if (cooldown > 0) {
        this.world.emit(h, {
          kind: 'action-unavailable',
          reason: `${actionLabel(kind)} is cooling down`,
        });
        continue;
      }
      // One action waits in the queue. A press that a newer one replaces is
      // reported, so no input is ever dropped without an answer.
      if (h.pendingAction)
        this.world.emit(h, {
          kind: 'action-unavailable',
          reason: `${actionLabel(h.pendingAction.kind)} was replaced by a newer press`,
        });
      h.pendingAction = { kind, yaw: kind === 'dodge' ? (movementYaw ?? h.aim) : h.aim };
    }
    if (!this.cancellable(h)) return false;
    const pending = h.pendingAction;
    if (pending) {
      if (pending.kind === 'dodge') this.startDash(h);
      else {
        h.pendingAction = undefined;
        if (pending.kind === 'sword') this.startSword(h, h.nextAttack, pending.yaw);
        else {
          this.start(h, 'ability', pending.yaw);
          h.cooldown = tuning.ability.cooldown;
        }
      }
      return false;
    }
    return h.state === 'idle' || h.state === 'walk' || movementYaw !== undefined;
  }
  advanceBurn(source: Actor) {
    if (this.world.movementPreview()) return;
    for (const target of this.world.actors()) {
      const burn = target.burn;
      if (!burn || target.health <= 0) continue;
      burn.remaining--;
      if (--burn.nextTick <= 0) {
        this.damage(source, target, tuning.ability.burnDamage, 'burn', 'over-time');
        // A lethal pulse clears the status; never rearm detached state.
        if (target.burn) target.burn.nextTick = tuning.ability.burnCadence;
      }
      if (burn.remaining <= 0) target.burn = undefined;
    }
  }
  advanceRecoil(actor: Actor) {
    const recoil = this.recoils.get(actor);
    if (!recoil) return;
    if (actor.health <= 0 || this.world.movementPreview()) {
      this.recoils.delete(actor);
      return;
    }
    const step =
      (2 * tuning.ability.recoilDistance * recoil.ticks) /
      (tuning.ability.recoilTicks * (tuning.ability.recoilTicks + 1));
    this.world.move(actor, recoil.x * step, recoil.z * step);
    if (--recoil.ticks === 0) this.recoils.delete(actor);
  }
  advance(a: Actor) {
    if (this.world.movementPreview() && (a.state === 'attack' || a.state === 'ability')) {
      this.start(a, 'idle');
      return;
    }
    if (a.state === 'attack') {
      if (a.definition.attack.kind === 'rib-lane') {
        this.advanceLane(a);
        return;
      }
      const t = attackDefinition(a);
      if (a.age === t.windup) this.world.emit(a, { kind: 'strike' });
      if (a.age >= t.windup && a.age < t.activeEnd) {
        const sy = Math.sin(a.yaw),
          cy = Math.cos(a.yaw);
        for (const target of this.world.actors()) {
          if (target.kind === a.kind || target.health <= 0 || a.hitIds.includes(target.id))
            continue;
          if (
            this.withinArc(a, target, t.range, t.halfAngle, sy, cy) &&
            clearSegment(this.area, a, target, 0.001)
          ) {
            a.hitIds.push(target.id);
            this.damage(a, target, t.damage);
          }
        }
        if (a.kind === 'hero')
          for (const object of this.area.interactables ?? [])
            if (
              object.kind === 'breakable' &&
              this.withinArc(
                a,
                {
                  x: object.x,
                  z: object.z,
                  y: heightAt(this.area, object.x, object.z),
                },
                t.range,
                t.halfAngle,
                sy,
                cy,
              ) &&
              clearSegment(this.area, a, object, 0.001)
            )
              this.world.breakObject(object.id);
      }
      if (a.age >= t.total - 1) this.start(a, 'idle');
    } else if (a.state === 'dodge') {
      if (a.age >= tuning.dodge.travelStart && a.age < tuning.dodge.travelEnd)
        this.world.move(
          a,
          (Math.sin(a.yaw) * tuning.dodge.speed) / 60,
          (Math.cos(a.yaw) * tuning.dodge.speed) / 60,
        );
      if (a.age >= tuning.dodge.total - 1) this.start(a, 'idle');
    } else if (a.state === 'ability') {
      if (a.age === tuning.ability.windup) {
        this.world.emit(a, { kind: 'flare' });
        for (const target of this.world.actors())
          if (
            target.kind === 'enemy' &&
            target.health > 0 &&
            this.withinArc(a, target, tuning.ability.range, Math.PI) &&
            clearSegment(this.area, a, target, 0.001)
          ) {
            this.damage(a, target, tuning.ability.damage, 'burn');
            if (target.health > 0) {
              const dx = target.x - a.x,
                dz = target.z - a.z,
                distance = Math.hypot(dx, dz);
              this.recoils.set(target, {
                x: distance > 0.001 ? dx / distance : Math.sin(a.yaw),
                z: distance > 0.001 ? dz / distance : Math.cos(a.yaw),
                ticks: tuning.ability.recoilTicks,
              });
              target.stun = tuning.ability.stun;
              target.burn = {
                remaining: tuning.ability.burnDuration,
                nextTick: target.burn?.nextTick ?? tuning.ability.burnCadence,
              };
              this.world.emit(a, {
                kind: 'stagger',
                target: target.id,
                duration: tuning.ability.stun,
              });
            }
            a.hitIds.push(target.id);
          }
      }
      if (a.age >= tuning.ability.total - 1) this.start(a, 'idle');
    } else if (
      a.state === 'hurt' &&
      // Stun expires at tick end; release its pose on that same tick.
      (a.kind === 'hero' || a.stun <= 1) &&
      a.age >= (a.kind === 'hero' ? tuning.hurt.total : tuning.enemyHurt.total) - 1
    )
      this.start(a, 'idle', a.yaw);
  }
}
