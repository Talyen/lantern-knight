import { type Inventory, type Equipment, type EquipmentSlot } from '../content/items';
import { InventoryState } from './inventory';
import { interactionTarget } from './interaction';
import { Navigation, effectiveRadius } from './navigation';
import { PLAYER_ID, heightAt, type ContentRegistry, type AreaId } from '../content/world';
import { Simulation, type Command, type StepResult } from './simulation';
import { tuning } from '../content/gameplay';
import { respawnAreaState, type AreaState } from './area-state';
import { parseGame, type GameSave } from './save';
import type { GameplayEvent, EventDetails } from './events';
// An opaque, single-use proposal. Candidate gameplay remains owned by GameSession.
export type RoomPlan = {
  readonly sourceGeneration: number;
  readonly destination: AreaId;
  readonly events: readonly GameplayEvent[];
};
type RoomState = {
  sim: Simulation;
  inventoryState: InventoryState;
  visited: Map<AreaId, AreaState>;
  discovered: Set<string>;
  lastFire: string | undefined;
  wins: number;
  resetCount: number;
};
type PendingRoom = {
  plan: RoomPlan;
  state: RoomState;
  outcome: EventDetails;
  cancellation?: EventDetails;
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
  private visited = new Map<AreaId, AreaState>();
  private pending: PendingRoom | undefined;
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
    this.visited.set(this.sim.area, this.sim.captureAreaState());
  }

  private roomState(): RoomState {
    // Saved area snapshots are detached values. Preparation replaces map entries,
    // never mutates snapshots shared with the currently accepted room.
    const visited = new Map(this.visited);
    visited.set(this.sim.area, this.sim.captureAreaState());
    return {
      sim: this.sim,
      inventoryState: this.inventoryState,
      visited,
      discovered: new Set(this.discovered),
      lastFire: this.lastFire,
      wins: this.wins,
      resetCount: this.resetCount,
    };
  }
  private restoredSimulation(
    state: RoomState,
    area: AreaId,
    entry?: string,
    seed = this.sim.initialSeed,
  ) {
    const sim = new Simulation(
      this.registry,
      seed,
      area,
      this.generation + 1,
      entry,
      state.inventoryState,
      state.visited.get(area),
    );
    sim.tick = this.sim.tick;
    sim.resetCount = state.resetCount;
    return sim;
  }
  private prepareRoom(state: RoomState, outcome: EventDetails, transition = false): RoomPlan {
    state.visited.set(state.sim.area, state.sim.captureAreaState());
    const destination = state.sim.area;
    const plan = Object.freeze({
      sourceGeneration: this.generation,
      destination,
      events: Object.freeze(
        transition ? [this.event({ kind: 'transition-start', destination })] : [],
      ),
    });
    this.pending = {
      plan,
      state,
      outcome,
      ...(transition
        ? { cancellation: { kind: 'transition-cancelled', destination } as EventDetails }
        : {}),
    };
    return plan;
  }
  checkRoomPlan(plan: RoomPlan) {
    if (this.pending?.plan !== plan || plan.sourceGeneration !== this.generation)
      throw new Error('stale room plan');
  }
  commitRoom(plan: RoomPlan): readonly GameplayEvent[] {
    this.checkRoomPlan(plan);
    const { state, outcome } = this.pending!;
    // All fallible construction and validation happened at preparation. Commit
    // only transfers ownership, before Application rebuilds its renderer.
    this.sim = state.sim;
    this.inventoryState = state.inventoryState;
    this.visited = state.visited;
    this.discovered = state.discovered;
    this.lastFire = state.lastFire;
    this.wins = state.wins;
    this.resetCount = state.resetCount;
    this.pending = undefined;
    return [this.event(outcome)];
  }
  cancelRoom(plan: RoomPlan): readonly GameplayEvent[] {
    if (this.pending?.plan !== plan) return [];
    const cancellation = this.pending.cancellation;
    this.pending = undefined;
    return cancellation ? [this.event(cancellation)] : [];
  }
  step(command: Command): StepResult {
    if (this.loading) return { events: [] };
    const result = this.sim.step(command);
    if (result.events.some((e) => e.kind === 'room-clear')) this.wins++;
    // Replacement is a host transaction: rendering must accept the new room before
    // feedback, resume or persistence. Like transitions, reset is only an intent.
    return result;
  }
  prepareTransition(exitId: string): RoomPlan {
    const exit = this.sim.areaDefinition.exits.find((e) => e.id === exitId);
    const target = exit?.explicit ? interactionTarget(this.sim, 'exit', exitId) : undefined;
    if (
      !exit ||
      this.sim.hero.health <= 0 ||
      !this.sim.exitAvailable(exitId) ||
      (exit.explicit && (!target || target.blocked))
    )
      throw new Error('exit unavailable');
    return this.prepareTravel(exit.destination, exit.entry);
  }
  private prepareTravel(destination: AreaId, entry: string): RoomPlan {
    const state = this.roomState(),
      player = this.sim.hero;
    const next = this.restoredSimulation(state, destination, entry);
    next.potionCooldown = this.sim.potionCooldown;
    next.hero.health = player.health;
    next.hero.cooldown = player.cooldown;
    next.hero.dodgeCooldown = player.dodgeCooldown;
    next.hero.nextAttack = player.nextAttack;
    state.sim = next;
    const fire = next.areaDefinition.campfires?.find((f) => entry === 'fire-' + f.id);
    const key = fire && next.area + '/' + fire.id;
    if (key && state.discovered.has(key)) state.lastFire = key;
    return this.prepareRoom(state, { kind: 'area-transition', destination }, true);
  }
  fire(key: string) {
    const [area, id] = key.split('/');
    const definition = this.registry.area(area!).campfires?.find((f) => f.id === id);
    if (!definition) throw new Error('Unknown campfire');
    return { area: area!, definition };
  }
  private canUseFire(id: string) {
    const target = interactionTarget(this.sim, 'campfire', id);
    return !!target && !target.blocked;
  }
  discoverFire(key: string) {
    const { area, definition } = this.fire(key);
    if (area !== this.sim.area || !this.canUseFire(definition.id))
      throw new Error('Campfire unavailable');
    this.discovered.add(key);
    this.lastFire = key;
  }
  prepareFireTravel(key: string): RoomPlan {
    if (!this.discovered.has(key)) throw new Error('Travel unavailable');
    if (
      !(this.sim.areaDefinition.campfires ?? []).some(
        (f) => this.discovered.has(this.sim.area + '/' + f.id) && this.canUseFire(f.id),
      )
    )
      throw new Error('Visit a campfire to travel');
    const { area, definition } = this.fire(key);
    return this.prepareTravel(area, 'fire-' + definition.id);
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
  private resetEnemies(state: RoomState) {
    for (const [area, saved] of state.visited) {
      const fresh = new Simulation(this.registry, this.sim.initialSeed, area);
      state.visited.set(area, respawnAreaState(saved, fresh.captureAreaState()));
    }
  }
  prepareReset(reason: 'death' | 'manual' = 'manual'): RoomPlan {
    const fire = reason === 'death' ? this.respawnFire() : undefined;
    const state = this.roomState();
    state.resetCount++;
    const adventure = this.registry.definitions.areas.some((a) => a.campfires?.length);
    if (!adventure) state.visited.delete(this.sim.area);
    else this.resetEnemies(state);
    state.sim = this.restoredSimulation(
      state,
      fire ? this.fire(fire).area : this.sim.area,
      fire ? 'fire-' + this.fire(fire).definition.id : undefined,
    );
    state.sim.hero.health = state.sim.maxHealth;
    return this.prepareRoom(state, { kind: 'room-reset', reason });
  }
  resetCurrentArea(reason: 'death' | 'manual' = 'manual'): readonly GameplayEvent[] {
    return this.commitRoom(this.prepareReset(reason));
  }
  prepareRest(key: string): RoomPlan {
    const { area, definition } = this.fire(key);
    if (area !== this.sim.area || !this.canUseFire(definition.id))
      throw new Error('Campfire unavailable');
    const state = this.roomState();
    state.discovered.add(key);
    state.lastFire = key;
    this.resetEnemies(state);
    state.sim = this.restoredSimulation(state, area, 'fire-' + definition.id);
    state.sim.hero.health = state.sim.maxHealth;
    return this.prepareRoom(state, { kind: 'room-reset', reason: 'manual' });
  }
  rest(key: string): readonly GameplayEvent[] {
    return this.commitRoom(this.prepareRest(key));
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
  prepareRestore(value: GameSave): RoomPlan {
    const save = parseGame(value, this.registry);
    const state: RoomState = {
      sim: this.sim,
      visited: new Map(Object.entries(save.areas)),
      inventoryState: new InventoryState(save.adventure ?? { inventory: {}, equipment: {} }),
      discovered: new Set(save.adventure?.discovered ?? []),
      lastFire: save.adventure?.lastFire,
      wins: save.wins,
      resetCount: this.resetCount,
    };
    const next = this.restoredSimulation(state, save.area, undefined, save.seed);
    // Checkpoint loading starts a fresh action clock, as before.
    next.tick = 0;
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
    state.sim = next;
    return this.prepareRoom(state, { kind: 'area-transition', destination: save.area });
  }
  restoreSave(save: GameSave): readonly GameplayEvent[] {
    return this.commitRoom(this.prepareRestore(save));
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
