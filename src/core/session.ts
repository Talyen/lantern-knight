import { type Inventory, type Equipment, type EquipmentSlot } from '../content/items';
import { InventoryState } from './inventory';
import { Navigation, effectiveRadius, clearSegment } from './navigation';
import {
  PLAYER_ID,
  spawnActorId,
  heightAt,
  type ContentRegistry,
  type AreaId,
} from '../content/world';
import { Simulation, type Command, type StepResult } from './simulation';
import { tuning } from '../content/gameplay';
import { parseGame, type GameSave, type SavedArea } from './save';
import type { GameplayEvent, EventDetails } from './events';
export type TransitionPlan = {
  readonly token: number;
  readonly sourceGeneration: number;
  readonly destination: AreaId;
  readonly entry: string;
  readonly events: readonly GameplayEvent[];
};
// Hosts may inspect a session, but only its owner may replace its simulation.
export interface SessionView {
  readonly registry: ContentRegistry;
  readonly generation: number;
  readonly loading: boolean;
  readonly wins: number;
  readonly resetCount: number;
  readonly inventory: Readonly<Inventory>;
  readonly equipment: Readonly<Equipment>;
  readonly discovered: ReadonlySet<string>;
  readonly lastFire: string | undefined;
  fire: GameSession['fire'];
  captureSave(): GameSave;
}
export class GameSession {
  readonly view: SessionView = sessionView(this);
  sim: Simulation;
  private inventoryState = new InventoryState();
  get inventory() {
    return this.inventoryState.inventory;
  }
  get equipment() {
    return this.inventoryState.equipment;
  }
  discovered = new Set<string>();
  lastFire: string | undefined;
  wins = 0;
  resetCount = 0;
  private visited = new Map<AreaId, SavedArea>();
  private request = 0;
  private pending: TransitionPlan | undefined;
  private eventSequence = 0;
  constructor(
    public readonly registry: ContentRegistry,
    seed = 142,
    area = registry.definitions.initialArea,
    generation = 1,
  ) {
    for (const a of registry.definitions.areas)
      for (const f of a.campfires ?? [])
        if (f.discovered) {
          this.discovered.add(a.id + '/' + f.id);
          this.lastFire = a.id + '/' + f.id;
        }
    if (registry.definitions.areas.some((a) => a.campfires?.length)) {
      this.inventoryState = new InventoryState({
        inventory: { sword: 1, lantern: 1, 'leather-armor': 1, gloves: 1, belt: 1, boots: 1 },
        equipment: {
          sword: 'sword',
          lantern: 'lantern',
          body: 'leather-armor',
          gloves: 'gloves',
          belt: 'belt',
          boots: 'boots',
        },
      });
    }
    this.sim = new Simulation(registry, seed, area, generation, undefined, this.inventoryState);
    this.recordArea();
  }
  get loading() {
    return this.pending !== undefined;
  }
  get generation() {
    return this.sim.generation;
  }
  private event(details: EventDetails): GameplayEvent {
    const a = this.sim.hero;
    return Object.freeze({
      key: `session:${this.generation}:${++this.eventSequence}`,
      tick: this.sim.tick,
      generation: this.generation,
      actor: PLAYER_ID,
      action: a.action,
      area: this.sim.area,
      position: Object.freeze([a.x, a.y, a.z]) as readonly [number, number, number],
      direction: a.yaw,
      ...details,
    });
  }
  private recordArea() {
    const actors = Object.fromEntries(
      this.sim.areaDefinition.spawns.map((p) => {
        const a = this.sim.actors.find((a) => a.id === spawnActorId(this.sim.area, p.id));
        if (!a) throw new Error(`missing spawn ${p.id}`);
        return [p.id, { x: a.x, z: a.z, health: a.health }];
      }),
    );
    this.visited.set(this.sim.area, {
      actors,
      ...(this.sim.collectedPickups.size
        ? { collectedPickups: [...this.sim.collectedPickups] }
        : {}),
      claimedObjects: [...this.sim.claimedObjects],
      drops: structuredClone(this.sim.drops),
      engaged: this.sim.engaged,
      cleared: Object.values(actors).every((a) => a.health === 0),
    });
  }
  private restoredSimulation(area: AreaId, generation: number, entry?: string) {
    const sim = new Simulation(
        this.registry,
        this.sim.initialSeed,
        area,
        generation,
        entry,
        this.inventoryState,
      ),
      state = this.visited.get(area);
    if (state) {
      for (const p of sim.areaDefinition.spawns) {
        const saved = state.actors[p.id]!,
          a = sim.actors.find((a) => a.id === spawnActorId(area, p.id))!;
        Object.assign(a, saved);
        a.y = heightAt(sim.areaDefinition, a.x, a.z);
        a.px = a.x;
        a.py = a.y;
        a.pz = a.z;
        if (a.health === 0) {
          sim.start(a, 'death');
          a.age = tuning.deathHoldTicks;
        }
      }
      sim.collectedPickups = new Set(state.collectedPickups ?? []);
      sim.claimedObjects = new Set(state.claimedObjects ?? []);
      sim.drops = structuredClone(state.drops ?? []);
      sim.cleared = state.cleared;
      sim.engaged = state.engaged;
    }
    sim.tick = this.sim.tick;
    sim.resetCount = this.resetCount;
    return sim;
  }
  step(command: Command): StepResult {
    if (this.loading) return { events: [] };
    const result = this.sim.step(command);
    if (result.events.some((e) => e.kind === 'room-clear')) this.wins++;
    // Replacement is a host transaction: rendering must accept the new room before
    // feedback, resume or persistence. Like transitions, reset is only an intent.
    return result;
  }
  prepareTransition(exitId: string): TransitionPlan {
    const exit = this.sim.areaDefinition.exits.find((e) => e.id === exitId);
    if (!exit || this.sim.hero.health <= 0 || !this.sim.exitAvailable(exitId))
      throw new Error('exit unavailable');
    this.recordArea();
    const events = [this.event({ kind: 'transition-start', destination: exit.destination })];
    const plan = Object.freeze({
      token: ++this.request,
      sourceGeneration: this.generation,
      destination: exit.destination,
      entry: exit.entry,
      events,
    });
    this.pending = plan;
    return plan;
  }
  commitTransition(plan: TransitionPlan): readonly GameplayEvent[] {
    if (
      this.pending !== plan ||
      plan.token !== this.request ||
      plan.sourceGeneration !== this.generation
    )
      throw new Error('stale transition');
    const player = this.sim.hero,
      next = this.restoredSimulation(plan.destination, this.generation + 1, plan.entry);
    next.potionCooldown = this.sim.potionCooldown;
    next.hero.health = player.health;
    next.hero.cooldown = player.cooldown;
    next.hero.dodgeCooldown = player.dodgeCooldown;
    next.hero.nextAttack = player.nextAttack;
    this.sim = next;
    this.pending = undefined;
    this.recordArea();
    return [this.event({ kind: 'area-transition', destination: plan.destination })];
  }
  cancelTransition(plan: TransitionPlan): readonly GameplayEvent[] {
    if (this.pending !== plan) return [];
    this.pending = undefined;
    return [this.event({ kind: 'transition-cancelled', destination: plan.destination })];
  }
  fire(key: string) {
    const [area, id] = key.split('/');
    const definition = this.registry.area(area!).campfires?.find((f) => f.id === id);
    if (!definition) throw new Error('Unknown campfire');
    return { area: area!, definition };
  }
  private canReachFire(fire: { x: number; z: number }) {
    return (
      Math.hypot(fire.x - this.sim.hero.x, fire.z - this.sim.hero.z) <= 1.8 &&
      Math.abs(heightAt(this.sim.areaDefinition, fire.x, fire.z) - this.sim.hero.y) <=
        tuning.maxCombatHeightDifference &&
      clearSegment(this.sim.areaDefinition, this.sim.hero, fire, 0.001)
    );
  }
  discoverFire(key: string) {
    const { area, definition } = this.fire(key);
    if (area !== this.sim.area || !this.canReachFire(definition) || this.sim.inCombat)
      throw new Error('Campfire unavailable');
    this.discovered.add(key);
    this.lastFire = key;
  }
  prepareFireTravel(key: string): TransitionPlan {
    if (!this.discovered.has(key) || this.sim.inCombat || this.sim.hero.health <= 0)
      throw new Error('Travel unavailable');
    if (
      !(this.sim.areaDefinition.campfires ?? []).some(
        (f) => this.discovered.has(this.sim.area + '/' + f.id) && this.canReachFire(f),
      )
    )
      throw new Error('Visit a campfire to travel');
    const { area, definition } = this.fire(key);
    this.recordArea();
    const plan = Object.freeze({
      token: ++this.request,
      sourceGeneration: this.generation,
      destination: area,
      entry: 'fire-' + definition.id,
      events: [this.event({ kind: 'transition-start', destination: area })],
    });
    this.pending = plan;
    return plan;
  }
  respawnFire() {
    const navigation = new Navigation(this.sim.areaDefinition);
    const candidates = [...this.discovered]
      .filter((key) => this.fire(key).area === this.sim.area)
      .map((key) => {
        const route = navigation.route(
          this.sim.hero,
          this.fire(key).definition,
          effectiveRadius(this.sim.hero.definition.radius),
        );
        let previous = this.sim.hero,
          distance = 0;
        for (const point of route.points) {
          distance += Math.hypot(point.x - previous.x, point.z - previous.z);
          previous = { ...previous, ...point };
        }
        return { key, distance: route.status === 'ready' ? distance : Infinity };
      })
      .filter((p) => Number.isFinite(p.distance))
      .sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));
    return candidates[0]?.key ?? this.lastFire;
  }
  resetDestination(reason: 'death' | 'manual' = 'manual') {
    const fire = reason === 'death' ? this.respawnFire() : undefined;
    return fire ? this.fire(fire).area : this.sim.area;
  }
  private resetEnemies() {
    this.recordArea();
    for (const [area, state] of this.visited) {
      const fresh = new Simulation(this.registry, this.sim.initialSeed, area);
      state.actors = Object.fromEntries(
        this.registry.area(area).spawns.map((p) => {
          const a = fresh.enemies.find((a) => a.id === spawnActorId(area, p.id))!;
          return [p.id, { x: a.x, z: a.z, health: a.health }];
        }),
      );
      state.cleared = fresh.cleared;
      state.engaged = fresh.engaged;
      state.drops = state.drops?.filter((d) => !d.enemy);
    }
  }
  resetCurrentArea(reason: 'death' | 'manual' = 'manual'): readonly GameplayEvent[] {
    const fire = reason === 'death' ? this.respawnFire() : undefined;
    this.pending = undefined;
    this.request++;
    this.resetCount++;
    const adventure = this.registry.definitions.areas.some((a) => a.campfires?.length);
    if (!adventure) {
      const tick = this.sim.tick;
      this.visited.delete(this.sim.area);
      this.sim = new Simulation(
        this.registry,
        this.sim.initialSeed,
        this.sim.area,
        this.generation + 1,
        undefined,
        this.inventoryState,
      );
      this.sim.tick = tick;
      this.sim.resetCount = this.resetCount;
      this.recordArea();
      return [this.event({ kind: 'room-reset', reason })];
    }
    this.resetEnemies();
    this.sim = this.restoredSimulation(
      fire ? this.fire(fire).area : this.sim.area,
      this.generation + 1,
      fire ? 'fire-' + this.fire(fire).definition.id : undefined,
    );
    this.sim.hero.health = this.sim.maxHealth;
    this.recordArea();
    return [this.event({ kind: 'room-reset', reason })];
  }
  rest(key: string): readonly GameplayEvent[] {
    this.discoverFire(key);
    this.pending = undefined;
    this.request++;
    this.resetEnemies();
    this.sim = this.restoredSimulation(
      this.sim.area,
      this.generation + 1,
      'fire-' + this.fire(key).definition.id,
    );
    this.sim.hero.health = this.sim.maxHealth;
    this.recordArea();
    return [this.event({ kind: 'room-reset', reason: 'manual' })];
  }
  equip(item: string, slot: EquipmentSlot) {
    if (this.sim.inCombat) throw new Error('Finish combat before changing equipment');
    this.inventoryState.equip(item, slot);
    this.sim.hero.health = Math.min(this.sim.hero.health, this.sim.maxHealth);
  }
  unequip(slot: EquipmentSlot) {
    if (this.sim.inCombat) throw new Error('Finish combat before changing equipment');
    this.inventoryState.unequip(slot);
    this.sim.hero.health = Math.min(this.sim.hero.health, this.sim.maxHealth);
  }
  salvage(item?: string) {
    if (this.sim.inCombat) throw new Error('Finish combat before salvaging');
    this.inventoryState.salvage(item);
  }
  captureSave(): GameSave {
    this.recordArea();
    const a = this.sim.hero;
    return {
      version: 7,
      adventure: {
        ...this.inventoryState.snapshot(),
        discovered: [...this.discovered],
        ...(this.lastFire ? { lastFire: this.lastFire } : {}),
        potionCooldown: this.sim.potionCooldown,
      },
      seed: this.sim.initialSeed,
      wins: this.wins,
      area: this.sim.area,
      player: {
        x: a.x,
        z: a.z,
        health: a.health,
        cooldown: a.cooldown,
        dodgeCooldown: a.dodgeCooldown,
        nextAttack: a.nextAttack,
      },
      areas: structuredClone(Object.fromEntries(this.visited)),
    };
  }
  restoreSave(save: GameSave): readonly GameplayEvent[] {
    save = parseGame(save, this.registry);
    this.pending = undefined;
    this.request++;
    this.visited = new Map(Object.entries(structuredClone(save.areas)));
    this.inventoryState = new InventoryState(save.adventure ?? { inventory: {}, equipment: {} });
    this.discovered = new Set(save.adventure?.discovered ?? []);
    this.lastFire = save.adventure?.lastFire;
    this.wins = save.wins;
    const old = this.sim;
    this.sim = new Simulation(this.registry, save.seed, save.area, old.generation + 1);
    const next = this.restoredSimulation(save.area, this.sim.generation);
    next.potionCooldown = save.adventure?.potionCooldown ?? 0;
    Object.assign(next.hero, save.player);
    next.hero.y = heightAt(next.areaDefinition, next.hero.x, next.hero.z);
    next.hero.px = next.hero.x;
    next.hero.py = next.hero.y;
    next.hero.pz = next.hero.z;
    if (next.hero.health === 0) {
      next.start(next.hero, 'death');
      next.hero.age = tuning.deathHoldTicks;
    }
    this.sim = next;
    return [this.event({ kind: 'area-transition', destination: save.area })];
  }
}

function sessionView(owner: GameSession): SessionView {
  return Object.freeze({
    get registry() {
      return owner.registry;
    },
    get generation() {
      return owner.generation;
    },
    get loading() {
      return owner.loading;
    },
    get wins() {
      return owner.wins;
    },
    get resetCount() {
      return owner.resetCount;
    },
    get inventory() {
      return owner.inventory;
    },
    get equipment() {
      return owner.equipment;
    },
    get discovered() {
      return owner.discovered;
    },
    get lastFire() {
      return owner.lastFire;
    },
    fire: (key: string) => owner.fire(key),
    captureSave: () => owner.captureSave(),
  });
}
