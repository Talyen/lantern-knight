import type { ForgeUpgrade } from '../content/progression';
import { borrowedView } from '../content/snapshot';
import { onboardingState, type OnboardingState, type Lesson } from './onboarding';
import { InventoryState, type InventoryAccess, type InventoryCommand } from './inventory';
import { interactionTarget } from './interaction';
import { Navigation, effectiveRadius } from './navigation';
import {
  PLAYER_ID,
  heightAt,
  type ContentRegistry,
  type AreaId,
  type Point,
} from '../content/world';
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
  onboarding: OnboardingState;
};
export type ForgePurchase = {
  readonly save: GameSave;
  commit(): readonly GameplayEvent[];
  cancel(): void;
};
type PendingRoom = {
  kind: 'room';
  plan: RoomPlan;
  state: RoomState;
  outcome: EventDetails;
  cancellation?: EventDetails;
};
// Hosts may inspect a session, but only its owner may replace its simulation.
const sessionProperties = [
  'registry',
  'generation',
  'loading',
  'wins',
  'resetCount',
  'inventory',
  'equipment',
  'forgeUpgrade',
  'discovered',
  'onboarding',
  'lastFire',
] as const;
export type SessionView = Readonly<
  Pick<GameSession, (typeof sessionProperties)[number] | 'fire' | 'captureSave'>
>;
export class GameSession {
  readonly view: SessionView = sessionView(this);
  private current: RoomState;
  get sim() {
    return this.current.sim;
  }
  get inventory() {
    return this.current.inventoryState.inventory;
  }
  get forgeUpgrade() {
    return this.current.inventoryState.forgeUpgrade;
  }
  get equipment() {
    return this.current.inventoryState.equipment;
  }
  get discovered(): ReadonlySet<string> {
    // Unlike per-frame simulation views, this small progression collection can
    // be detached so even untyped hosts cannot mutate the accepted owner.
    return new Set(this.current.discovered);
  }
  get onboarding() {
    return this.current.onboarding;
  }
  get lastFire() {
    return this.current.lastFire;
  }
  get wins() {
    return this.current.wins;
  }
  get resetCount() {
    return this.current.resetCount;
  }
  private pending: PendingRoom | { kind: 'purchase'; plan: ForgePurchase } | undefined;
  private eventSequence = 0;
  constructor(
    public readonly registry: ContentRegistry,
    seed = 142,
    area = registry.definitions.initialArea,
    generation = 1,
  ) {
    const discovered = new Set<string>();
    let lastFire: string | undefined;
    let inventoryState = new InventoryState();
    for (const a of registry.definitions.areas)
      for (const f of a.campfires ?? [])
        if (f.discovered) {
          discovered.add(a.id + '/' + f.id);
          if (!lastFire || a.id === area) lastFire = a.id + '/' + f.id;
        }
    if (registry.definitions.areas.some((a) => a.campfires?.length)) {
      inventoryState = new InventoryState({
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
    this.current = {
      sim: new Simulation(
        registry,
        seed,
        area,
        generation,
        undefined,
        this.roomInventory(inventoryState),
      ),
      inventoryState,
      visited: new Map(),
      discovered,
      lastFire,
      wins: 0,
      resetCount: 0,
      onboarding: onboardingState(),
    };
  }
  private assertProgressionWritable(inventory = this.current.inventoryState) {
    if (inventory !== this.current.inventoryState) throw new Error('inactive room inventory');
    if (this.loading) throw new Error('Wait for the area to finish loading');
  }
  private roomInventory(inventory: InventoryState): InventoryAccess {
    return Object.freeze<InventoryAccess>({
      get inventory() {
        return inventory.inventory;
      },
      get equipment() {
        return inventory.equipment;
      },
      get forgeUpgrade() {
        return inventory.forgeUpgrade;
      },
      get healthBonus() {
        return inventory.healthBonus;
      },
      award: (rewards) => {
        this.assertProgressionWritable(inventory);
        inventory.award(rewards);
      },
      consume: (item) => {
        this.assertProgressionWritable(inventory);
        return inventory.consume(item);
      },
    });
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

  private roomState(): RoomState {
    // Saved area snapshots are detached values. Preparation replaces map entries,
    // never mutates snapshots shared with the currently accepted room.
    const visited = new Map(this.current.visited);
    visited.set(this.sim.area, this.sim.captureAreaState());
    return {
      sim: this.sim,
      inventoryState: new InventoryState(this.current.inventoryState.snapshot()),
      visited,
      discovered: new Set(this.current.discovered),
      lastFire: this.lastFire,
      wins: this.wins,
      resetCount: this.resetCount,
      onboarding: this.onboarding,
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
      this.roomInventory(state.inventoryState),
      state.visited.get(area),
    );
    // The accepted simulation owns the current room. Keep snapshots only for
    // inactive rooms, so capturing a checkpoint never mutates session state.
    state.visited.delete(area);
    sim.tick = this.sim.tick;
    return sim;
  }
  private prepareRoom(state: RoomState, outcome: EventDetails, transition = false): RoomPlan {
    const destination = state.sim.area;
    const plan = Object.freeze({
      sourceGeneration: this.generation,
      destination,
      events: Object.freeze(
        transition ? [this.event({ kind: 'transition-start', destination })] : [],
      ),
    });
    this.pending = {
      kind: 'room',
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
    if (
      this.pending?.kind !== 'room' ||
      this.pending.plan !== plan ||
      plan.sourceGeneration !== this.generation
    )
      throw new Error('stale room plan');
  }
  commitRoom(plan: RoomPlan): readonly GameplayEvent[] {
    this.checkRoomPlan(plan);
    const { state, outcome } = this.pending as PendingRoom;
    // All fallible construction and validation happened at preparation. Commit
    // only transfers ownership, before Application rebuilds its renderer.
    this.current = state;
    this.pending = undefined;
    return [this.event(outcome)];
  }
  cancelRoom(plan: RoomPlan): readonly GameplayEvent[] {
    if (this.pending?.kind !== 'room' || this.pending.plan !== plan) return [];
    const cancellation = this.pending.cancellation;
    this.pending = undefined;
    return cancellation ? [this.event(cancellation)] : [];
  }
  step(command: Command): StepResult {
    if (this.loading) return { events: [] };
    const previousOnboarding = this.onboarding;
    const result = this.sim.step(command);
    if (result.events.some((e) => e.kind === 'room-clear')) this.current.wins++;
    // Replacement is a host transaction: rendering must accept the new room before
    // feedback, resume or persistence. Like transitions, reset is only an intent.
    for (const event of result.events) {
      if (event.actor !== PLAYER_ID) continue;
      if (
        event.kind === 'object-claimed' &&
        this.sim.areaDefinition.interactables?.some(
          (o) => o.id === event.object && o.kind === 'breakable',
        )
      )
        this.completeLesson('sword');
      if (event.kind === 'damage' && event.amount > 0)
        this.completeLesson(event.damageType === 'physical' ? 'sword' : 'lantern');
      if (event.kind === 'flare') this.completeLesson('lantern');
      if (event.kind === 'dodge') this.completeLesson('dodge');
      if (event.kind === 'potion-used') this.completeLesson('potion');
    }
    if (!this.onboarding.completed.includes('hook')) {
      const entry = this.sim.areaDefinition.entries.find(
        (e) => e.id === this.sim.areaDefinition.baselineEntry,
      )!;
      if (Math.hypot(this.sim.hero.x - entry.x, this.sim.hero.z - entry.z) >= 2)
        this.completeLesson('hook');
    }
    return previousOnboarding === this.onboarding ? result : { ...result, onboardingChanged: true };
  }
  completeLesson(lesson: Lesson) {
    this.assertProgressionWritable();
    if (this.onboarding.completed.includes(lesson)) return false;
    this.current.onboarding = onboardingState({
      completed: [...this.onboarding.completed, lesson],
      dismissed: this.onboarding.dismissed.filter((id) => id !== lesson),
    });
    return true;
  }
  dismissLesson(lesson: Lesson) {
    this.assertProgressionWritable();
    if (this.onboarding.completed.includes(lesson) || this.onboarding.dismissed.includes(lesson))
      return;
    this.current.onboarding = onboardingState({
      completed: [...this.onboarding.completed],
      dismissed: [...this.onboarding.dismissed, lesson],
    });
  }
  replayHints() {
    this.assertProgressionWritable();
    this.current.onboarding = onboardingState();
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
    const [area, id, extra] = key.split('/');
    if (!area || !id || extra !== undefined) throw new Error('Unknown campfire');
    const definition = this.registry.area(area!).campfires?.find((f) => f.id === id);
    if (!definition) throw new Error('Unknown campfire');
    return { area: area!, definition };
  }
  private canUseFire(id: string) {
    const target = interactionTarget(this.sim, 'campfire', id);
    return !!target && !target.blocked;
  }
  discoverFire(key: string) {
    this.assertProgressionWritable();
    const { area, definition } = this.fire(key);
    if (area !== this.sim.area || !this.canUseFire(definition.id))
      throw new Error('Campfire unavailable');
    const first = !this.current.discovered.has(key);
    this.current.discovered.add(key);
    this.current.lastFire = key;
    this.completeLesson('campfire');
    return first ? [this.event({ kind: 'campfire-discovered', fire: key })] : [];
  }
  prepareFireTravel(key: string): RoomPlan {
    if (!this.current.discovered.has(key)) throw new Error('Travel unavailable');
    if (
      !(this.sim.areaDefinition.campfires ?? []).some(
        (f) => this.current.discovered.has(this.sim.area + '/' + f.id) && this.canUseFire(f.id),
      )
    )
      throw new Error('Visit a campfire to travel');
    const { area, definition } = this.fire(key);
    const plan = this.prepareTravel(area, 'fire-' + definition.id);
    (this.pending as PendingRoom).state.onboarding = onboardingState({
      completed: [...this.onboarding.completed.filter((id) => id !== 'travel'), 'travel'],
      dismissed: this.onboarding.dismissed.filter((id) => id !== 'travel'),
    });
    return plan;
  }
  respawnFire() {
    const area = this.sim.areaDefinition,
      hero = this.sim.hero,
      navigation = new Navigation(area);
    let nearest: string | undefined,
      shortest = Infinity;
    for (const fire of area.campfires ?? []) {
      const key = area.id + '/' + fire.id;
      if (!this.current.discovered.has(key)) continue;
      const route = navigation.route(
        hero,
        area.entries.find((entry) => entry.id === 'fire-' + fire.id)!,
        effectiveRadius(hero.definition.radius),
      );
      if (route.status !== 'ready') continue;
      let previous: Point = hero,
        distance = 0;
      for (const point of route.points) {
        distance += Math.hypot(point.x - previous.x, point.z - previous.z);
        previous = point;
      }
      if (distance < shortest || (distance === shortest && key.localeCompare(nearest!) < 0)) {
        nearest = key;
        shortest = distance;
      }
    }
    return nearest ?? this.lastFire;
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
    if (!adventure) {
      const fresh = new Simulation(this.registry, this.sim.initialSeed, this.sim.area);
      state.visited.set(this.sim.area, {
        ...respawnAreaState(state.visited.get(this.sim.area)!, fresh.captureAreaState()),
        collectedPickups: [],
      });
    } else this.resetEnemies(state);
    state.sim = this.restoredSimulation(
      state,
      fire ? this.fire(fire).area : this.sim.area,
      fire ? 'fire-' + this.fire(fire).definition.id : undefined,
    );
    state.sim.hero.health = state.sim.maxHealth;
    if (fire) state.lastFire = fire;
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
    return this.prepareRoom(state, { kind: 'rested' });
  }
  rest(key: string): readonly GameplayEvent[] {
    return this.commitRoom(this.prepareRest(key));
  }
  changeInventory(command: InventoryCommand) {
    this.assertProgressionWritable();
    if (this.sim.inCombat)
      throw new Error(
        command.kind === 'salvage'
          ? 'Finish combat before salvaging'
          : 'Finish combat before changing equipment',
      );
    if (!this.current.inventoryState.change(command)) return [];
    if (command.kind === 'equip' && command.item === 'orchard-ring')
      this.completeLesson('inventory');
    if (command.kind !== 'salvage')
      this.sim.hero.health = Math.min(this.sim.hero.health, this.sim.maxHealth);
    return [this.event({ kind: 'inventory-changed', operation: command.kind })];
  }
  prepareForgePurchase(id: string, choice: ForgeUpgrade): ForgePurchase {
    this.assertProgressionWritable();
    const target = interactionTarget(this.sim, 'workbench', id);
    if (!target || target.blocked) throw new Error(target?.blocked ?? 'Visit the forge workbench');
    const owner = this.current.inventoryState;
    const generation = this.generation;
    const tick = this.sim.tick;
    const purchase = owner.prepareForgePurchase(choice);
    const save = this.captureSave();
    Object.assign(save.adventure!, purchase.snapshot);
    const plan: ForgePurchase = Object.freeze({
      // Callers persist detached data; changing an exported checkpoint cannot
      // change the reserved candidate or a later retry's write.
      get save() {
        return structuredClone(save);
      },
      commit: () => {
        if (this.pending?.kind !== 'purchase' || this.pending.plan !== plan)
          throw new Error('Stale forge purchase');
        if (
          this.current.inventoryState !== owner ||
          this.generation !== generation ||
          this.sim.tick !== tick
        )
          throw new Error('Stale forge purchase');
        this.pending = undefined;
        purchase.commit();
        return [this.event({ kind: 'inventory-changed', operation: 'upgrade' })];
      },
      cancel: () => {
        if (this.pending?.kind === 'purchase' && this.pending.plan === plan)
          this.pending = undefined;
      },
    });
    this.pending = { kind: 'purchase', plan };
    return plan;
  }

  captureSave(): GameSave {
    const a = this.sim.hero;
    return {
      version: 9,
      adventure: {
        ...this.current.inventoryState.snapshot(),
        discovered: [...this.current.discovered],
        ...(this.lastFire ? { lastFire: this.lastFire } : {}),
        potionCooldown: this.sim.potionCooldown,
        onboarding: {
          completed: [...this.onboarding.completed],
          dismissed: [...this.onboarding.dismissed],
        },
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
      areas: {
        ...structuredClone(Object.fromEntries(this.current.visited)),
        [this.sim.area]: this.sim.captureAreaState(),
      },
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
      onboarding: onboardingState(save.adventure?.onboarding),
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
  return borrowedView(owner, sessionProperties, {
    fire: (key: string) => owner.fire(key),
    captureSave: () => owner.captureSave(),
  });
}
