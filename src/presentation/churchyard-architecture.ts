import type { Mesh, Group } from 'three';
import type { PackLease } from '../assets/loader';
import type { WorldVisualDefinition } from '../content/world-art';
import type { Simulation } from '../core/simulation';

// Building shells are intact placements owned by GraveyardRoom. This adapter
// preserves the diagnostics/resource seam without manufacturing architecture.
export class ChurchyardArchitecture {
  readonly parts: Mesh[] = [];
  constructor(_packs: Map<string, PackLease>, _group: Group, _art: WorldVisualDefinition) {}
  build() {}
  update(_sim: Simulation, _alpha: number, _ms: number) {}
  dispose() {}
}
