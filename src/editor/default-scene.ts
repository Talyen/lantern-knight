import court from '../../authoring/scenes/live-court.json';
import chapel from '../../authoring/scenes/live-upper-landing.json';
import { parseSceneDocument, type SceneDocument } from '../content/scene-document';

export function emptyScene(base: SceneDocument['base'] = 'flat'): SceneDocument {
  if (base !== 'flat')
    return parseSceneDocument({
      ...structuredClone(base === 'court' ? court : chapel),
      id: 'untitled',
      name: `Copy of ${base === 'court' ? 'Graveyard Approach' : 'Ruined Chapel'}`,
      target: 'draft',
    });
  return {
    version: 5,
    profile: 'study',
    id: 'untitled',
    name: 'Untitled scene',
    base,
    target: 'draft',
    floor: { asset: 'ink-moss', clip: 'surface', width: 20, depth: 20 },
    camera: { bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, bias: { x: 0, z: 0 } },
    proceduralAssets: [],
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
