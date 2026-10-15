import { borrowedView, type ContentSnapshot } from '../content/snapshot';
import type { Actor, Simulation } from './simulation';

// A borrowed view of the current tick, not a checkpoint or retained snapshot.
// Simulation owns all writes; presentation may retain only its own derived state.
export type ActorView = ContentSnapshot<Actor>;
const properties = [
  'initialSeed',
  'maxHealth',
  'forgeUpgrade',
  'inCombat',
  'tick',
  'generation',
  'area',
  'areaDefinition',
  'hero',
  'actors',
  'enemies',
  'cleared',
  'claimedObjects',
  'objectActions',
  'drops',
  'collectedPickups',
] as const;
type Borrowed<T> =
  T extends Set<infer V>
    ? ReadonlySet<V>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<K, V>
      : ContentSnapshot<T>;
export type SimulationView = {
  readonly [K in (typeof properties)[number]]: Borrowed<Simulation[K]>;
} & Pick<Simulation, 'navigationDebug'>;

// Keep identity stable and read live state without copying actors every frame.
// Actor/collection immutability is enforced by TypeScript, as with asset pack views.
export function simulationView(sim: Simulation): SimulationView {
  return borrowedView(sim, properties, {
    navigationDebug: (includeCells?: boolean) => sim.navigationDebug(includeCells),
  });
}
