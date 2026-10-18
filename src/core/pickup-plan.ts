import { heightAt, type Point } from '../content/world';
import { Navigation } from './navigation';
import { effectiveRadius } from '../content/collision';
import { canReachInteraction, interactionTarget } from './interaction';
import type { Simulation, Command } from './simulation';
import { acceptCommand } from './command';

// A transient input intent. Checkpoints contain drops, never pending UI requests.
export class PickupPlan {
  private navigation: Navigation | undefined;
  private pending: { id: string; generation: number } | undefined;
  cancel(sim: Simulation) {
    if (this.pending?.generation === sim.generation) sim.setMovementTarget(sim.hero.id, null);
    this.pending = undefined;
  }
  request(sim: Simulation, id: string): boolean {
    const drop = sim.drops.find((d) => d.id === id);
    if (!drop || sim.hero.health <= 0) return false;
    if (interactionTarget(sim, 'drop', id)) {
      this.cancel(sim);
      this.pending = { id, generation: sim.generation };
      return true;
    }
    if (this.navigation?.area !== sim.areaDefinition)
      this.navigation = new Navigation(sim.areaDefinition);
    const navigation = this.navigation;
    const radius = effectiveRadius(sim.hero.definition.radius);
    let destination: Point | undefined;
    let bestDistanceSquared = Infinity;
    const consider = (p: Point) => {
      const dx = p.x - sim.hero.x,
        dz = p.z - sim.hero.z,
        distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= bestDistanceSquared) return;
      const hero = { ...p, health: sim.hero.health, y: heightAt(sim.areaDefinition, p.x, p.z) };
      if (
        canReachInteraction(sim.areaDefinition, hero, drop) &&
        navigation.route(sim.hero, p, radius).status === 'ready'
      ) {
        destination = p;
        bestDistanceSquared = distanceSquared;
      }
    };
    consider(drop);
    for (const ring of [0.5, 1.15, 1.5, 1.6])
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8;
        consider({ x: drop.x + Math.cos(angle) * ring, z: drop.z + Math.sin(angle) * ring });
      }
    if (!destination) return false;
    this.cancel(sim);
    sim.setMovementTarget(sim.hero.id, destination);
    this.pending = { id, generation: sim.generation };
    return true;
  }
  beforeStep(sim: Simulation, command: Command) {
    if (command.generation !== undefined && command.generation !== sim.generation) return;
    const accepted = acceptCommand(command, sim.generation, sim.hero);
    if (
      this.pending &&
      (this.pending.generation !== sim.generation ||
        sim.hero.health <= 0 ||
        Math.hypot(accepted.move.x, accepted.move.z) > 0.01 ||
        accepted.actions.length ||
        accepted.potion)
    )
      this.cancel(sim);
  }
  ready(sim: Simulation): string | undefined {
    const pending = this.pending;
    if (!pending) return;
    if (
      pending.generation !== sim.generation ||
      sim.hero.health <= 0 ||
      !sim.drops.some((d) => d.id === pending.id)
    ) {
      this.cancel(sim);
      return;
    }
    if (interactionTarget(sim, 'drop', pending.id)) {
      this.cancel(sim);
      return pending.id;
    }
  }
}
