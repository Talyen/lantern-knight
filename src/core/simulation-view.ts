import { borrowedView, type ContentSnapshot } from '../content/snapshot';
import type { Actor, Simulation } from './simulation';

// A borrowed view of the current tick, not a checkpoint or retained snapshot.
// Simulation owns all writes; presentation may retain only its own derived state.
export type ActorView = ContentSnapshot<Actor>;
export interface SimulationView {
  readonly initialSeed: number;
  readonly maxHealth: number;
  readonly inCombat: boolean;
  readonly tick: number;
  readonly generation: number;
  readonly area: Simulation['area'];
  readonly areaDefinition: Simulation['areaDefinition'];
  readonly hero: ActorView;
  readonly actors: readonly ActorView[];
  readonly enemies: readonly ActorView[];
  readonly cleared: boolean;
  readonly claimedObjects: ReadonlySet<string>;
  readonly objectActions: ReadonlyMap<string, number>;
  readonly drops: ContentSnapshot<import('../content/interactions').GroundDrop[]>;
  readonly collectedPickups: ReadonlySet<string>;
  navigationDebug(includeCells?: boolean): ReturnType<Simulation['navigationDebug']>;
}

// Keep identity stable and read live state without copying actors every frame.
// Actor/collection immutability is enforced by TypeScript, as with asset pack views.
export function simulationView(sim: Simulation): SimulationView {
  return borrowedView(
    sim,
    [
      'initialSeed',
      'maxHealth',
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
    ],
    {
      navigationDebug: (includeCells?: boolean) => sim.navigationDebug(includeCells),
    },
  );
}
