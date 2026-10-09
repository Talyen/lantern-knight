import type { SceneDocument } from '../content/scene-document';

export function emptyScene(): SceneDocument {
  return {
    version: 5,
    profile: 'study',
    id: 'untitled',
    name: 'Untitled scene',
    base: 'flat',
    target: 'draft',
    floor: { asset: 'ink-moss', clip: 'surface', width: 20, depth: 20 },
    camera: { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, bias: { x: 0, z: 0 } },
    proceduralAssets: [],
    gameplay: { spawns: [], exits: [], pickups: [] },
    paths: [],
    walls: [],
    graves: [],
    propOrder: [],
    overlaps: [],
    objects: [],
    hero: { x: 0, z: 0 },
    look: { rig: 'golden', look: 'diorama' },
  };
}
