import type { Simulation } from './simulation';
import type { SimulationView } from './simulation-view';
import type { AreaDefinition, Point } from '../content/world';
import { clearSegment } from './navigation';
import { heightAt } from '../content/world';
import { tuning } from '../content/gameplay';
import { items } from '../content/items';
export type Interaction = {
  kind: 'drop' | 'campfire' | 'container' | 'exit' | 'breakable' | 'workbench';
  id: string;
  label: string;
  blocked?: string;
  x: number;
  z: number;
};
// Queries borrow state and cannot execute gameplay commands. The same policy is
// used at command admission, even when a caller never rendered a prompt.
type InteractionState = Pick<
  SimulationView,
  'areaDefinition' | 'hero' | 'claimedObjects' | 'drops'
> &
  Readonly<Pick<Simulation, 'registry' | 'inCombat' | 'guardsDefeated' | 'exitAvailable'>>;

function choices(sim: InteractionState): Interaction[] {
  return [
    ...sim.drops.map((d) => ({
      kind: 'drop' as const,
      id: d.id,
      label: 'Collect ' + d.rewards.map((r) => `${r.amount} ${items[r.item]!.name}`).join(', '),
      x: d.x,
      z: d.z,
    })),
    ...(sim.areaDefinition.campfires ?? []).map((f) => ({
      kind: 'campfire' as const,
      id: f.id,
      label: f.name,
      blocked: sim.inCombat ? 'Finish combat to use the campfire' : undefined,
      x: f.x,
      z: f.z,
    })),
    ...(sim.areaDefinition.interactables ?? [])
      .filter((o) => !sim.claimedObjects.has(o.id))
      .map((o) => ({
        kind: o.kind,
        id: o.id,
        label:
          o.kind === 'workbench'
            ? 'Forge workbench'
            : o.kind === 'breakable'
              ? 'LMB · Break'
              : 'Open container',
        blocked:
          o.kind === 'workbench' && sim.inCombat
            ? 'Finish combat to use the workbench'
            : !sim.guardsDefeated(o.guards)
              ? 'Defeat the guard to open'
              : undefined,
        x: o.x,
        z: o.z,
      })),
    ...sim.areaDefinition.exits
      .filter((e) => e.explicit)
      .map((e) => ({
        kind: 'exit' as const,
        id: e.id,
        label: 'Travel to ' + sim.registry.area(e.destination).name,
        blocked: !sim.exitAvailable(e.id)
          ? 'Defeat the enemies by the departure'
          : sim.inCombat
            ? 'Finish combat to travel'
            : undefined,
        x: e.marker.x,
        z: e.marker.z,
      })),
  ];
}

export function canReachInteraction(
  area: AreaDefinition,
  hero: Pick<SimulationView['hero'], 'health' | 'x' | 'y' | 'z'>,
  target: Point,
) {
  return (
    hero.health > 0 &&
    Math.hypot(target.x - hero.x, target.z - hero.z) <= 1.6 &&
    Math.abs(heightAt(area, target.x, target.z) - hero.y) <= tuning.maxCombatHeightDifference &&
    clearSegment(area, hero, target, 0.001)
  );
}

// Resolve by identity, not by nearest choice: another nearby target must never
// authorize this command, and a previously displayed prompt may now be stale.
export function interactionTarget(sim: InteractionState, kind: Interaction['kind'], id: string) {
  const target = choices(sim).find((target) => target.kind === kind && target.id === id);
  return target && canReachInteraction(sim.areaDefinition, sim.hero, target) ? target : undefined;
}

export function nearbyInteraction(sim: InteractionState): Interaction | undefined {
  // Prefer available E actions; sword-only prompts and blocked targets remain fallbacks.
  return choices(sim)
    .filter((target) => canReachInteraction(sim.areaDefinition, sim.hero, target))
    .sort(
      (a, b) =>
        Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) ||
        Number(a.kind === 'breakable') - Number(b.kind === 'breakable') ||
        (a.kind === 'drop' ? -1 : 0) - (b.kind === 'drop' ? -1 : 0) ||
        Math.hypot(a.x - sim.hero.x, a.z - sim.hero.z) -
          Math.hypot(b.x - sim.hero.x, b.z - sim.hero.z),
    )[0];
}
