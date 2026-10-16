import { scaledDamage } from '../content/progression';
import { tuning, attackDefinition } from '../content/gameplay';
import { heightAt, type AreaDefinition, type Point } from '../content/world';
import type { Actor, State } from './actor';
import type { EventDetails, DamageType, DamagePhase } from './events';
import { selectAuthoredDirection } from '../content/headings';
import { clearSegment } from './navigation';
import type { AcceptedCommand } from './command';

// Borrow current actors and room capabilities; combat cannot replace the room,
// award inventory, plan routes, or persist state. Simulation owns those outcomes.
interface CombatWorld {
  actors(): readonly Actor[];
  movementPreview(): boolean;
  damagePercent(type: DamageType): number;
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
  constructor(
    private readonly area: AreaDefinition,
    private readonly generation: number,
    private readonly world: CombatWorld,
  ) {}
  start(a: Actor, state: State, yaw = a.aim) {
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
    generation = this.generation,
    damageType: DamageType = 'physical',
    phase: DamagePhase = 'direct',
  ) {
    if (
      this.world.movementPreview() ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      generation !== this.generation ||
      !this.world.actors().includes(from) ||
      !this.world.actors().includes(to) ||
      to.health <= 0 ||
      (to.kind === 'hero' &&
        to.state === 'dodge' &&
        to.age >= tuning.dodge.invulnerableStart &&
        to.age < tuning.dodge.invulnerableEnd)
    )
      return;
    if (to.kind === 'enemy') this.world.enemyHit(to);
    const resolved =
      from.kind === 'hero' ? scaledDamage(amount, this.world.damagePercent(damageType)) : amount;
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
  ) {
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
    if (this.world.movementPreview() && h.pendingAction?.kind !== 'dodge')
      h.pendingAction = undefined;
    for (const kind of command.actions) {
      if (this.world.movementPreview() && kind !== 'dodge') continue;
      const cooldown = kind === 'lantern' ? h.cooldown : kind === 'dodge' ? h.dodgeCooldown : 0;
      if (cooldown > 0) {
        this.world.emit(h, {
          kind: 'action-unavailable',
          reason: `${kind === 'lantern' ? 'Lantern' : 'Dodge'} is cooling down`,
        });
        continue;
      }
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
      burn.nextTick--;
      if (burn.nextTick === 0) {
        this.damage(
          source,
          target,
          tuning.ability.burnDamage,
          this.generation,
          'burn',
          'over-time',
        );
        burn.nextTick = tuning.ability.burnCadence;
      }
      if (burn.remaining === 0) target.burn = undefined;
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
      const t = attackDefinition(a);
      if (a.age === t.windup) this.world.emit(a, { kind: 'strike' });
      if (a.age >= t.windup && a.age < t.activeEnd)
        for (const target of this.world.actors()) {
          if (target.kind === a.kind || target.health <= 0 || a.hitIds.includes(target.id))
            continue;
          if (
            this.withinArc(a, target, t.range, t.halfAngle) &&
            clearSegment(this.area, a, target, 0.001)
          ) {
            a.hitIds.push(target.id);
            this.damage(a, target, t.damage);
          }
        }
      if (a.kind === 'hero' && a.age >= t.windup && a.age < t.activeEnd)
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
            ) &&
            clearSegment(this.area, a, object, 0.001)
          )
            this.world.breakObject(object.id);
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
            this.damage(a, target, tuning.ability.damage, this.generation, 'burn');
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
      a.age >= (a.kind === 'hero' ? tuning.hurt.total : tuning.enemyHurt.total) - 1
    )
      this.start(a, 'idle', a.yaw);
  }
}
