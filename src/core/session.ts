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
export class GameSession {
  sim: Simulation;
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
    this.sim = new Simulation(registry, seed, area, generation);
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
      engaged: this.sim.engaged,
      cleared: Object.values(actors).every((a) => a.health === 0),
    });
  }
  private restoredSimulation(area: AreaId, generation: number, entry?: string) {
    const sim = new Simulation(this.registry, this.sim.initialSeed, area, generation, entry),
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
    if (result.reset) return { events: this.resetCurrentArea('death'), reset: 'death' };
    return result;
  }
  prepareTransition(exitId: string): TransitionPlan {
    const exit = this.sim.areaDefinition.exits.find((e) => e.id === exitId);
    if (!exit || this.sim.hero.health <= 0 || (exit.requiresClear && !this.sim.cleared))
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
  resetCurrentArea(reason: 'death' | 'manual' = 'manual'): readonly GameplayEvent[] {
    this.pending = undefined;
    this.request++;
    const old = this.sim;
    this.resetCount++;
    this.visited.delete(old.area);
    this.sim = new Simulation(this.registry, old.initialSeed, old.area, old.generation + 1);
    this.sim.tick = old.tick;
    this.sim.resetCount = this.resetCount;
    this.recordArea();
    return [this.event({ kind: 'room-reset', reason })];
  }
  captureSave(): GameSave {
    this.recordArea();
    const a = this.sim.hero;
    return {
      version: 6,
      seed: this.sim.initialSeed,
      wins: this.wins,
      area: this.sim.area,
      player: {
        x: a.x,
        z: a.z,
        health: a.health,
        cooldown: a.cooldown,
        dodgeCooldown: a.dodgeCooldown,
      },
      areas: structuredClone(Object.fromEntries(this.visited)),
    };
  }
  restoreSave(save: GameSave): readonly GameplayEvent[] {
    save = parseGame(save, this.registry);
    this.pending = undefined;
    this.request++;
    this.visited = new Map(Object.entries(structuredClone(save.areas)));
    this.wins = save.wins;
    const old = this.sim;
    this.sim = new Simulation(this.registry, save.seed, save.area, old.generation + 1);
    const next = this.restoredSimulation(save.area, this.sim.generation);
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
