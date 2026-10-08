import { ContentRegistry, type ContentDefinitions } from './world';
import { churchyardColliders } from './world-art';
import { tuning } from './gameplay';
import { actorVisuals, assetCatalog } from './visuals';
export const contentDefinitions: ContentDefinitions = {
  initialArea: 'court',
  player: 'lamplighter',
  actors: [
    {
      id: 'skeleton',
      kind: 'enemy',
      maxHealth: 50,
      radius: 0.25,
      speed: 0.9,
      melee: { windup: 39, activeEnd: 43, total: 68, range: 1.2, halfAngle: 1.1, damage: 8 },
      visual: 'skeleton',
    },
    {
      id: 'lamplighter',
      kind: 'hero',
      maxHealth: tuning.heroMaxHealth,
      radius: tuning.heroRadius,
      speed: tuning.moveSpeed,
      melee: { ...tuning.attack },
      visual: 'hero',
    },
  ],
  areas: [
    {
      id: 'court',
      name: 'Graveyard Approach',
      subtitle: 'A worn path leads between the graves to the chapel.',
      bounds: { minX: -6.5, maxX: 6.5, minZ: -6.3, maxZ: 8 },
      surface: {
        kind: 'stairs',
        steps: 2,
        stairWidth: 3.0,
        terraceBounds: { minX: -2.95, maxX: 2.95, minZ: -6.6, maxZ: -5.7 },
        axis: 'z',
        start: -5.1,
        end: -5.7,
        startHeight: 0,
        endHeight: 0.3,
      },
      seedOffset: 0,
      baselineEntry: 'start',
      entries: [
        { id: 'start', x: -3.3, z: 6.65 },
        { id: 'from-landing', x: 0, z: -5.5 },
      ],
      activation: { minX: -6.5, maxX: 6.5, minZ: -6.3, maxZ: 2.0 },
      spawns: [{ id: 'warden-1', actor: 'skeleton', x: 0.7, z: 0.0 }],
      props: churchyardColliders('court'),
      floorColor: 0x34434a,
      exits: [
        {
          id: 'landing',
          trigger: { minX: -0.95, maxX: 0.95, minZ: -6.3, maxZ: -5.75 },
          destination: 'upper-landing',
          entry: 'start',
          requiresClear: true,
          marker: { x: 0, z: -6.15 },
        },
      ],
    },
    {
      id: 'upper-landing',
      name: 'Ruined Chapel',
      subtitle: 'The restless dead gather in the ruined nave.',
      bounds: { minX: -5.7, maxX: 5.7, minZ: -8.7, maxZ: 8.7 },
      surface: { kind: 'flat', height: 0.3 },
      seedOffset: 101,
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 7.5 }],
      activation: { minX: -5.7, maxX: 5.7, minZ: -8.7, maxZ: 4.3 },
      spawns: [
        { id: 'warden-1', actor: 'skeleton', x: -2.0, z: 1.0 },
        { id: 'warden-2', actor: 'skeleton', x: 1.7, z: -1.3 },
      ],
      props: churchyardColliders('upper-landing'),
      floorColor: 0x3e444e,
      exits: [
        {
          id: 'court',
          trigger: { minX: -0.95, maxX: 0.95, minZ: 8.1, maxZ: 8.7 },
          destination: 'court',
          entry: 'from-landing',
          requiresClear: false,
          marker: { x: 0, z: 9 },
        },
      ],
    },
  ],
};
for (const actor of contentDefinitions.actors) {
  const visual = actorVisuals[actor.visual];
  if (!visual || !assetCatalog[visual.asset])
    throw new Error(`content: unknown visual ${actor.visual}`);
}
export const content = new ContentRegistry(contentDefinitions);
