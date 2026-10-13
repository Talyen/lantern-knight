import type { Simulation } from './simulation';
import { clearSegment } from './navigation';
import { items } from '../content/items';
export type Interaction = {
  kind: 'drop' | 'campfire' | 'container' | 'exit' | 'breakable';
  id: string;
  label: string;
  blocked?: string;
  x: number;
  z: number;
};
export function nearbyInteraction(sim: Simulation): Interaction | undefined {
  if (sim.hero.health <= 0) return;
  const choices: Interaction[] = [
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
        label: o.kind === 'breakable' ? 'LMB · Break crate' : 'Open container',
        blocked: !sim.guardsDefeated(o.guards) ? 'Defeat the guard to open' : undefined,
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
  return choices
    .filter(
      (p) =>
        Math.hypot(p.x - sim.hero.x, p.z - sim.hero.z) <= 1.6 &&
        clearSegment(sim.areaDefinition, sim.hero, p, 0.001),
    )
    .sort(
      (a, b) =>
        (a.kind === 'drop' ? -1 : 0) - (b.kind === 'drop' ? -1 : 0) ||
        Math.hypot(a.x - sim.hero.x, a.z - sim.hero.z) -
          Math.hypot(b.x - sim.hero.x, b.z - sim.hero.z),
    )[0];
}
