import type { Mesh, Group } from 'three';
import type { PackLease } from '../assets/loader';
import type { WorldVisualDefinition } from '../content/world-art';
import type { AreaDefinition } from '../content/world';
import type { OcclusionFades } from './occlusion-fades';
import { graveyardGroundMaterial } from './graveyard-ground';

// The complete illustrated sanctuary is placed by InkRoom, with registered sockets.
export class CryptArchitecture {
  readonly parts: Mesh[] = [];
  readonly textureBytes = 0;
  constructor(
    _area: AreaDefinition,
    private art: WorldVisualDefinition,
    private packs: Map<string, PackLease>,
    _room: Group,
    _fades: OcclusionFades,
  ) {}
  floorMaterial() {
    return graveyardGroundMaterial(this.packs, this.art);
  }
  build() {}
  dispose() {}
}
