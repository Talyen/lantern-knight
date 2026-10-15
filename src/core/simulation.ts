import { kitAttributes } from '../content/progression';
import { parseAreaState, type AreaState } from './area-state';
import { InventoryState, type InventoryAccess } from './inventory';
import type { GroundDrop } from '../content/interactions';
import { interactionTarget } from './interaction';
import { simulationView } from './simulation-view';
import { moveSupported, effectiveRadius, clearSegment } from './navigation';
import { MovementPlans } from './movement-plans';
import { EncounterBehavior } from './encounter-behavior';
import type { Point } from '../content/world';
import type { ContentSnapshot } from '../content/snapshot';
import { CombatActions } from './combat-actions';
import { tuning } from '../content/gameplay';
import {
  ContentRegistry,
  PLAYER_ID,
  spawnActorId,
  contains,
  heightAt,
  type AreaId,
  type ActorId,
} from '../content/world';
import type { GameplayEvent, EventDetails } from './events';
import type { Actor, State } from './actor';
import type { HeroAction } from './actor';
export type { Actor, State } from './actor';
export type Command = {
  move: { x: number; z: number };
  aim: { x: number; z: number };
  attack?: boolean;
  dodge?: boolean;
  ability?: boolean;
  actions?: readonly HeroAction[];
  generation?: number;
  potion?: boolean;
};
export type SimEvent = GameplayEvent;
export type StepResult = {
  events: readonly GameplayEvent[];
  transition?: string;
  onboardingChanged?: boolean;
  reset?: 'death';
};
export class Simulation {
  readonly #view = simulationView(this);
  get view() {
    return this.#view;
  }
  movementPreview = false;
  private readonly movement: MovementPlans;
  private readonly encounter: EncounterBehavior;
  readonly #combat: CombatActions;
  setMovementTarget(id: string, target: Point | null) {
    const actor = this.actors.find((a) => a.id === id);
    if (!actor) throw new Error('Unknown movement actor');
    this.movement.setManual(actor, target, this.tick);
  }
  navigationDebug(includeCells = true) {
    return this.movement.debug(effectiveRadius(this.hero.definition.radius), includeCells);
  }
  private follow(actor: Actor, intent?: { kind: 'home' | 'pursuit'; target: Point }) {
    return this.movement.follow(actor, this.tick, (a, x, z) => this.move(a, x, z), intent);
  }
  tick = 0;
  seed: number;
  readonly initialSeed: number;
  actors: Actor[] = [];
  collectedPickups = new Set<string>();
  get inventory() {
    return this.inventoryAccess.inventory;
  }
  get forgeUpgrade() {
    return this.inventoryAccess.forgeUpgrade;
  }
  get equipment() {
    return this.inventoryAccess.equipment;
  }
  claimedObjects = new Set<string>();
  objectActions = new Map<string, number>();
  drops: GroundDrop[] = [];
  potionCooldown = 0;
  get maxHealth() {
    return this.hero.definition.maxHealth + this.inventoryAccess.healthBonus;
  }
  guardsDefeated(ids: readonly string[] = []) {
    return ids.every(
      (id) => this.enemies.find((a) => a.id === spawnActorId(this.area, id))?.health === 0,
    );
  }
  exitAvailable(id: string) {
    const e = this.areaDefinition.exits.find((e) => e.id === id);
    return Boolean(e && (!e.requiresClear || this.cleared) && this.guardsDefeated(e.guards));
  }
  get inCombat() {
    return this.encounter.inCombat(this.hero, this.enemies, this.engaged);
  }

  openContainer(id: string) {
    const target = interactionTarget(this, 'container', id);
    if (!target || target.blocked) return false;
    return this.claimObject(id);
  }
  private claimObject(id: string) {
    const object = this.areaDefinition.interactables?.find((p) => p.id === id);
    if (
      !object ||
      object.kind === 'workbench' ||
      this.claimedObjects.has(id) ||
      !this.guardsDefeated(object.guards)
    )
      return false;
    this.claimedObjects.add(id);
    this.objectActions.set(id, this.tick);
    if (object.rewards.length)
      this.drops.push(
        ...object.rewards.map((reward, index) => ({
          id: 'object-' + id + '-' + index,
          source: id,
          enemy: false,
          x: object.x,
          z: object.z,
          rewards: [structuredClone(reward)],
        })),
      );
    this.emit(this.hero, { kind: 'object-claimed', object: id });
    return true;
  }
  private dropEnemyRewards(actor: Actor) {
    const spawn = this.areaDefinition.spawns.find(
      (p) => spawnActorId(this.area, p.id) === actor.id,
    );
    if (spawn?.rewards?.length)
      this.drops.push(
        ...spawn.rewards.map((reward, index) => ({
          id: 'enemy-' + spawn.id + '-' + index,
          source: spawn.id,
          enemy: true,
          x: actor.x,
          z: actor.z,
          rewards: [structuredClone(reward)],
        })),
      );
  }
  collectDrop(id: string) {
    const drop = this.drops.find((p) => p.id === id);
    if (!drop || !interactionTarget(this, 'drop', id)) return false;
    this.inventoryAccess.award(drop.rewards);
    for (const reward of drop.rewards)
      this.emit(this.hero, { kind: 'pickup', pickup: reward.item, amount: reward.amount });
    this.drops = this.drops.filter((p) => p !== drop);
    return true;
  }

  private tickEvents: SimEvent[] = [];
  cleared = false;
  readonly generation: number;
  resetCount = 0;
  completedEncounters = 0;
  engaged = false;
  constructor(
    public readonly registry: ContentRegistry,
    seed = 142,
    public readonly area: AreaId = registry.definitions.initialArea,
    generation = 1,
    entry?: string,
    private readonly inventoryAccess: InventoryAccess = new InventoryState(),
    areaState?: ContentSnapshot<AreaState>,
  ) {
    this.encounter = new EncounterBehavior(this.areaDefinition);
    this.movement = new MovementPlans(this.areaDefinition, this.encounter.traversal);
    this.#combat = new CombatActions(this.areaDefinition, generation, {
      actors: () => this.actors,
      movementPreview: () => this.movementPreview,
      damagePercent: (type) => {
        const attributes = kitAttributes(this.inventoryAccess.forgeUpgrade);
        return type === 'physical' ? attributes.edge : attributes.ember;
      },
      emit: (actor, details) => this.emit(actor, details),
      move: (actor, x, z) => this.move(actor, x, z),
      enemyHit: (actor) => {
        this.engaged = true;
        this.encounter.alert(actor);
      },
      enemyDefeated: (actor) => this.dropEnemyRewards(actor),
      breakObject: (id) => {
        this.claimObject(id);
      },
    });
    this.initialSeed = seed;
    this.seed = seed;
    this.generation = generation;
    this.populate(entry);
    if (areaState) this.restoreAreaState(areaState);
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
    this.movement.clear();
    this.collectedPickups.clear();
    this.claimedObjects.clear();
    this.objectActions.clear();
    this.encounter.reset();
    this.drops = [];
    this.tickEvents = [];
    this.potionCooldown = 0;
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
  captureAreaState(): AreaState {
    const actors = Object.fromEntries(
      this.areaDefinition.spawns.map((spawn) => {
        const actor = this.actors.find((actor) => actor.id === spawnActorId(this.area, spawn.id));
        if (!actor) throw new Error(`missing spawn ${spawn.id}`);
        return [
          spawn.id,
          {
            x: actor.x,
            z: actor.z,
            health: actor.health,
            ...(actor.burn ? { burn: { ...actor.burn } } : {}),
          },
        ];
      }),
    );
    return {
      actors,
      collectedPickups: [...this.collectedPickups],
      claimedObjects: [...this.claimedObjects],
      drops: structuredClone(this.drops),
      alerted: this.encounter.captureAlerts(),
      engaged: this.engaged,
      // Damage can clear the encounter between fixed steps.
      cleared: Object.values(actors).every((actor) => actor.health === 0),
    };
  }
  private restoreAreaState(value: ContentSnapshot<AreaState>) {
    const state = parseAreaState(value, this.registry, this.area);
    for (const spawn of this.areaDefinition.spawns) {
      const actor = this.actors.find((actor) => actor.id === spawnActorId(this.area, spawn.id))!;
      Object.assign(actor, state.actors[spawn.id]);
      actor.y = heightAt(this.areaDefinition, actor.x, actor.z);
      actor.px = actor.x;
      actor.py = actor.y;
      actor.pz = actor.z;
      if (actor.health === 0) {
        this.start(actor, 'death');
        actor.age = tuning.deathHoldTicks;
      }
    }
    this.collectedPickups = new Set(state.collectedPickups ?? []);
    this.claimedObjects = new Set(state.claimedObjects ?? []);
    this.drops = state.drops ?? [];
    this.encounter.restoreAlerts(state.alerted ?? []);
    this.cleared = state.cleared;
    this.engaged = state.engaged;
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
    this.#combat.start(a, state, yaw);
  }
  startSword(a: Actor, kind = a.nextAttack) {
    this.#combat.startSword(a, kind);
  }
  move(a: Actor, x: number, z: number) {
    const position = moveSupported(
      this.areaDefinition,
      a,
      { x, z },
      effectiveRadius(a.definition.radius),
    );
    if (a.kind === 'enemy' && !this.encounter.traversal.segment(a, position)) return;
    a.x = position.x;
    a.z = position.z;
    a.y = heightAt(this.areaDefinition, a.x, a.z);
  }
  damage(from: Actor, to: Actor, amount: number, generation = this.generation) {
    this.#combat.damage(from, to, amount, generation);
  }
  step(command?: Command): StepResult {
    this.tick++;
    this.tickEvents = [];
    const h = this.hero;
    command ??= { move: { x: 0, z: 0 }, aim: { x: h.x, z: h.z } };
    this.potionCooldown = Math.max(0, this.potionCooldown - 1);
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
    }
    if (
      Number.isFinite(command.aim.x) &&
      Number.isFinite(command.aim.z) &&
      Math.hypot(command.aim.x - h.x, command.aim.z - h.z) > 0.001
    )
      h.aim = Math.atan2(command.aim.x - h.x, command.aim.z - h.z);
    if (!Number.isFinite(command.move.x) || !Number.isFinite(command.move.z))
      command = { ...command, move: { x: 0, z: 0 } };
    const len = Math.hypot(command.move.x, command.move.z),
      mx = len <= 0.01 ? 0 : len > 1 ? command.move.x / len : command.move.x,
      mz = len <= 0.01 ? 0 : len > 1 ? command.move.z / len : command.move.z;
    if (h.health > 0) {
      if (len > 0.01) this.movement.cancel(h.id);
      if (
        command.potion &&
        !this.movementPreview &&
        this.potionCooldown === 0 &&
        h.health < this.maxHealth &&
        this.inventoryAccess.consume('health-potion')
      ) {
        h.health = Math.min(this.maxHealth, h.health + 40);
        this.potionCooldown = 60;
        this.emit(h, { kind: 'potion-used' });
      } else if (command.potion && !this.movementPreview)
        this.emit(h, {
          kind: 'action-unavailable',
          reason:
            h.health >= this.maxHealth
              ? 'Health is already full'
              : !(this.inventory['health-potion'] ?? 0)
                ? 'No Health Potions'
                : 'Potion is cooling down',
        });
      if (this.#combat.admitHero(h, command, len > 0.01 ? Math.atan2(mx, mz) : undefined)) {
        if (len <= 0.01 && this.movement.has(h.id)) {
          this.follow(h);
        } else {
          h.state = len > 0.01 ? 'walk' : 'idle';
          h.yaw = h.state === 'walk' ? Math.atan2(mx, mz) : h.aim;
          this.move(h, (mx * h.definition.speed) / 60, (mz * h.definition.speed) / 60);
        }
      }
    }
    this.#combat.advanceBurn(h);
    if (this.areaDefinition.activation && contains(this.areaDefinition.activation, h))
      this.engaged = true;
    for (const a of this.actors) {
      if (a.health <= 0) continue;
      this.#combat.advanceRecoil(a);
      if (a.kind === 'enemy') {
        const intent = this.encounter.decide(a, h, this.engaged, this.movementPreview);
        if (intent.kind === 'none' && !this.movement.manual(a.id)) {
          this.movement.cancel(a.id);
          if (a.state === 'walk') this.start(a, 'idle');
        }
        if (intent.cancelAttack && a.state === 'attack') this.start(a, 'idle');
        if (intent.kind === 'home' && (a.state === 'idle' || a.state === 'walk')) {
          if (a.stun === 0) this.follow(a, { kind: 'home', target: intent.target });
          else a.state = 'idle';
          continue;
        }
        if (
          intent.kind === 'pursuit' &&
          a.stun === 0 &&
          (a.state === 'idle' || a.state === 'walk')
        ) {
          a.aim = Math.atan2(h.x - a.x, h.z - a.z);
          if (intent.attack && !this.movement.manual(a.id)) {
            a.state = 'idle';
            if (!this.movementPreview) this.start(a, 'attack');
          } else this.follow(a, { kind: 'pursuit', target: h });
        }
        if (a.stun > 0 && (a.state === 'walk' || a.state === 'idle')) a.state = 'idle';
      }
      this.#combat.advance(a);
    }
    // Every actor observes the same action tick during combat, including dodge protection.
    for (const a of this.actors) {
      a.age++;
      a.stun = Math.max(0, a.stun - 1);
    }
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
    if (h.health > 0 && !this.movementPreview)
      for (const pickup of this.areaDefinition.pickups ?? []) {
        if (
          this.collectedPickups.has(pickup.id) ||
          Math.hypot(h.x - pickup.x, h.z - pickup.z) > pickup.radius ||
          Math.abs(h.y - heightAt(this.areaDefinition, pickup.x, pickup.z)) >
            tuning.maxCombatHeightDifference ||
          !clearSegment(this.areaDefinition, h, pickup, 0.001) ||
          h.health >= this.maxHealth
        )
          continue;
        const amount = Math.min(pickup.amount, this.maxHealth - h.health);
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
      h.health > 0 && !this.movementPreview
        ? this.areaDefinition.exits.find((e) => {
            const bounds = this.areaDefinition.bounds;
            // Boundary markers may sit beyond the walkable room. Keep the contact ray inside it.
            const marker = {
              x: Math.max(bounds.minX + 0.01, Math.min(bounds.maxX - 0.01, e.marker.x)),
              z: Math.max(bounds.minZ + 0.01, Math.min(bounds.maxZ - 0.01, e.marker.z)),
            };
            return (
              !e.explicit &&
              this.exitAvailable(e.id) &&
              contains(e.trigger, h) &&
              Math.abs(h.y - heightAt(this.areaDefinition, marker.x, marker.z)) <=
                tuning.maxCombatHeightDifference &&
              clearSegment(this.areaDefinition, h, marker, 0.001)
            );
          })
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
    if (!Number.isFinite(ms)) return Math.max(0, this.accumulator / this.stepMs);
    const bounded = Math.min(Math.max(ms, 0), maximumFrameMs);
    this.droppedMs += Math.max(0, ms - bounded);
    this.accumulator += bounded;
    let steps = 0;
    while (this.accumulator + 1e-8 >= this.stepMs && steps < 6) {
      this.accumulator -= this.stepMs;
      const keepGoing = step();
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
