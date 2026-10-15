import { heightAt } from '../content/world';
import { Navigation, effectiveRadius } from './navigation';
import { interactionTarget } from './interaction';
import type { Simulation, Command } from './simulation';

// A transient input intent. Checkpoints contain drops, never pending UI requests.
export class PickupPlan {
  private pending: { id: string; generation: number } | undefined;
  cancel(sim: Simulation) {
    if (this.pending?.generation === sim.generation) sim.setMovementTarget(sim.hero.id, null);
    this.pending = undefined;
  }
  request(sim: Simulation, id: string): boolean {
    this.cancel(sim);
    const drop = sim.drops.find((d) => d.id === id);
    if (!drop || sim.hero.health <= 0) return false;
    if (interactionTarget(sim, 'drop', id)) {
      this.pending = { id, generation: sim.generation };
      return true;
    }
    const navigation = new Navigation(sim.areaDefinition);
    const candidates = [
      drop,
      ...[0.5, 1.15, 1.5].flatMap((radius) =>
        Array.from({ length: 16 }, (_, i) => ({
          x: drop.x + Math.cos((i * Math.PI) / 8) * radius,
          z: drop.z + Math.sin((i * Math.PI) / 8) * radius,
        })),
      ),
    ].sort(
      (a, b) =>
        Math.hypot(a.x - sim.hero.x, a.z - sim.hero.z) -
        Math.hypot(b.x - sim.hero.x, b.z - sim.hero.z),
    );
    const destination = candidates.find((p) => {
      const hero = { ...sim.hero, ...p, y: heightAt(sim.areaDefinition, p.x, p.z) };
      return (
        interactionTarget(
          {
            areaDefinition: sim.areaDefinition,
            hero,
            claimedObjects: sim.claimedObjects,
            drops: sim.drops,
            registry: sim.registry,
            inCombat: sim.inCombat,
            guardsDefeated: (ids) => sim.guardsDefeated(ids),
            exitAvailable: (exit) => sim.exitAvailable(exit),
          },
          'drop',
          id,
        ) &&
        navigation.route(sim.hero, p, effectiveRadius(sim.hero.definition.radius)).status ===
          'ready'
      );
    });
    if (!destination) return false;
    sim.setMovementTarget(sim.hero.id, destination);
    this.pending = { id, generation: sim.generation };
    return true;
  }
  beforeStep(sim: Simulation, command: Command) {
    if (
      this.pending &&
      (this.pending.generation !== sim.generation ||
        sim.hero.health <= 0 ||
        Math.hypot(command.move.x, command.move.z) > 0.01 ||
        command.actions?.length ||
        command.attack ||
        command.ability ||
        command.dodge ||
        command.potion)
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
