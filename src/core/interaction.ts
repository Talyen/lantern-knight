import type { Simulation } from './simulation';
import type { SimulationView } from './simulation-view';
import type { AreaDefinition, Point } from '../content/world';
import { clearSegment } from '../content/collision';
import { heightAt } from '../content/world';
import { tuning } from '../content/gameplay';
import { items } from '../content/items';
export type Interaction = {
  kind: 'drop' | 'campfire' | 'container' | 'exit' | 'breakable';
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
  Readonly<Pick<Simulation, 'registry' | 'inCombat'>>;

function* choices(
  sim: InteractionState,
  kind?: Interaction['kind'],
  id?: string,
): Generator<Interaction, undefined> {
  const reachable = (point: Point & { id: string }, candidate: Interaction['kind']) =>
    (!kind || candidate === kind) &&
    (id === undefined || point.id === id) &&
    canReachInteraction(sim.areaDefinition, sim.hero, point);
  // Combat status is fixed for the query; read once instead of re-scanning actors per target.
  const inCombat = kind === undefined || kind === 'campfire' ? sim.inCombat : false;
  if (!kind || kind === 'drop')
    for (const d of sim.drops)
      if (reachable(d, 'drop'))
        yield {
          kind: 'drop',
          id: d.id,
          x: d.x,
          z: d.z,
          label: 'Collect ' + d.rewards.map((r) => `${r.amount} ${items[r.item]!.name}`).join(', '),
        };
  if (!kind || kind === 'campfire')
    for (const f of sim.areaDefinition.campfires ?? [])
      if (reachable(f, 'campfire'))
        yield {
          kind: 'campfire',
          id: f.id,
          x: f.x,
          z: f.z,
          label: f.name,
          blocked: inCombat ? 'Finish combat to use the campfire' : undefined,
        };
  if (!kind || kind === 'container' || kind === 'breakable')
    for (const o of sim.areaDefinition.interactables ?? [])
      if (!sim.claimedObjects.has(o.id) && reachable(o, o.kind))
        yield {
          kind: o.kind,
          id: o.id,
          x: o.x,
          z: o.z,
          label: o.kind === 'breakable' ? 'LMB · Break' : 'Open container',
        };
  if (!kind || kind === 'exit')
    for (const e of sim.areaDefinition.exits)
      if (e.explicit && reachable({ ...e.marker, id: e.id }, 'exit'))
        yield {
          kind: 'exit',
          id: e.id,
          x: e.marker.x,
          z: e.marker.z,
          label: 'Travel to ' + sim.registry.area(e.destination).name,
        };
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
  return choices(sim, kind, id).next().value;
}

export function nearbyInteraction(sim: InteractionState): Interaction | undefined {
  // Prefer available E actions; sword-only prompts and blocked targets remain fallbacks.
  // Priority: unblocked, non-breakable, drops, then nearest distance.
  const rank = (target: Interaction) =>
    (target.blocked ? 4 : 0) +
    (target.kind === 'breakable' ? 2 : 0) -
    (target.kind === 'drop' ? 1 : 0);
  let best: Interaction | undefined;
  let bestRank = Infinity;
  let bestDistance = Infinity;
  for (const target of choices(sim)) {
    const distance = Math.hypot(target.x - sim.hero.x, target.z - sim.hero.z);
    const priority = rank(target);
    if (!best || priority < bestRank || (priority === bestRank && distance < bestDistance)) {
      best = target;
      bestRank = priority;
      bestDistance = distance;
    }
  }
  return best;
}
