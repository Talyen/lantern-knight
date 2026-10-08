import { tuning } from './gameplay';
import { ContentRegistry, type ContentDefinitions } from './world';
import { contentDefinitions } from './game-content';
export const sandboxDefinitions: ContentDefinitions = {
  ...contentDefinitions,
  actors: [
    ...contentDefinitions.actors,
    {
      id: 'warden',
      kind: 'enemy',
      maxHealth: tuning.enemy.maxHealth,
      radius: tuning.heroRadius,
      speed: tuning.enemy.speed,
      melee: { ...tuning.enemy, halfAngle: 1.1 },
      visual: 'skeleton',
    },
    {
      id: 'heavy-warden',
      kind: 'enemy',
      maxHealth: 140,
      radius: 0.35,
      speed: 0.75,
      melee: {
        windup: 42,
        activeEnd: 46,
        total: 72,
        range: 1.25,
        halfAngle: 1.1,
        damage: 20,
      },
      visual: 'skeleton',
    },
  ],
  areas: [
    ...contentDefinitions.areas,
    {
      id: 'systems-fixture',
      name: 'Systems verification fixture',
      subtitle: 'Two melee profiles. Five wardens.',
      bounds: { minX: -5, maxX: 5, minZ: -4, maxZ: 6 },
      surface: {
        kind: 'ramp',
        axis: 'x',
        start: -1,
        end: 2,
        startHeight: 0,
        endHeight: 0.3,
      },
      seedOffset: 202,
      baselineEntry: 'start',
      entries: [{ id: 'start', x: 0, z: 4 }],
      spawns: [-3, -1.5, 0, 1.5, 3].map((x, i) => ({
        id: `fixture-${i + 1}`,
        actor: i % 2 ? 'heavy-warden' : 'warden',
        x,
        z: -2,
      })),
      props: [],
      floorColor: 0x34434a,
      exits: [],
    },
  ],
};
export const sandboxContent = new ContentRegistry(sandboxDefinitions);
