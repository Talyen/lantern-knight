import { tuning, attackDefinition } from '../content/gameplay';
import { heightAt, type AreaDefinition, type Point } from '../content/world';
import type { Actor, State } from './actor';
import type { EventDetails } from './events';
import { selectAuthoredDirection } from './camera';
import { clearSegment } from './navigation';

// Borrow current actors and room capabilities; combat cannot replace the room,
// award inventory, plan routes, or persist state. Simulation owns those outcomes.
interface CombatWorld {
  actors(): readonly Actor[];
  movementPreview(): boolean;
  emit(actor: Actor, details: EventDetails): unknown;
  move(actor: Actor, x: number, z: number): void;
  enemyHit(actor: Actor): void;
  enemyDefeated(actor: Actor): void;
  breakObject(id: string): void;
}

type ActionCommand = { attack?: boolean; dodge?: boolean; ability?: boolean };

// One room-local owner for action admission, interruption, damage and recovery.
// Actor clocks remain on actors; the fixed-step coordinator advances them once,
// after every actor has resolved combat against the same action tick.
export class CombatActions {
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
  startSword(a: Actor, kind = a.nextAttack) {
    a.attackKind = kind;
    a.nextAttack = kind === 'sweep' ? 'lunge' : 'sweep';
    a.attackBufferedUntil = -1;
    this.start(a, 'attack');
  }
  private startDash(a: Actor) {
    a.dashBufferedUntil = -1;
    a.attackBufferedUntil = -1;
    this.start(a, 'dodge', a.dashYaw);
    a.dodgeCooldown = tuning.dodge.cooldown;
  }
  damage(from: Actor, to: Actor, amount: number, generation = this.generation) {
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
    const actual = Math.min(to.health, amount);
    to.health -= actual;
    this.world.emit(from, { kind: 'damage', target: to.id, amount: actual });
    to.attackBufferedUntil = -1;
    to.dashBufferedUntil = -1;
    this.start(to, to.health <= 0 ? 'death' : 'hurt', to.yaw);
    if (!to.health) {
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
  // True only when locomotion may run instead of an action this tick.
  admitHero(h: Actor, command: ActionCommand, tick: number, movementYaw?: number): boolean {
    if (command.attack && !this.world.movementPreview())
      h.attackBufferedUntil = tick + tuning.inputBufferTicks;
    if (command.dodge) {
      h.dashBufferedUntil = tick + tuning.dashBufferTicks;
      h.dashYaw = movementYaw ?? h.aim;
    }
    const available = h.state === 'idle' || h.state === 'walk';
    if (available && h.dashBufferedUntil >= tick && h.dodgeCooldown === 0) this.startDash(h);
    else if (available) {
      if (command.ability && !this.world.movementPreview() && h.cooldown === 0) {
        h.attackBufferedUntil = -1;
        this.start(h, 'ability');
        h.cooldown = tuning.ability.cooldown;
      } else if (h.attackBufferedUntil >= tick) {
        this.startSword(h);
      } else return true;
    }
    return false;
  }
  advance(a: Actor) {
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
            this.withinArc(a, target, tuning.ability.range, tuning.ability.halfAngle) &&
            clearSegment(this.area, a, target, 0.001)
          ) {
            this.damage(a, target, tuning.ability.damage);
            if (target.health > 0) {
              target.stun = tuning.ability.stun;
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
