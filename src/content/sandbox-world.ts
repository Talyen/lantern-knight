import { tuning } from './gameplay';
import { ContentRegistry, type AreaDefinition, type ContentDefinitions } from './world';
import { contentDefinitions } from './game-content';
import { developerScenes } from './developer-scenes';
// Comparison copies cannot duplicate the adventure's unique rewards.
const fixtureCopy = (id: string, fixture: string): AreaDefinition => {
  const area = contentDefinitions.areas.find((candidate) => candidate.id === id)!;
  return {
    ...area,
    id: fixture,
    exits: [],
    interactables: area.interactables?.map((object) => ({ ...object, rewards: [] })),
    spawns: area.spawns.map((spawn) => ({ ...spawn, rewards: [] })),
  };
};
export const sandboxDefinitions: ContentDefinitions = {
  ...contentDefinitions,
  initialArea: 'outdoor-fixture',
  actors: [
    ...contentDefinitions.actors,
    {
      id: 'warden',
      kind: 'enemy',
      maxHealth: tuning.enemy.maxHealth,
      radius: tuning.heroRadius,
      speed: tuning.enemy.speed,
      attack: { kind: 'melee', ...tuning.enemy, halfAngle: 1.1 },
      visual: 'ossuary-thrall',
    },
    {
      id: 'heavy-warden',
      kind: 'enemy',
      maxHealth: 140,
      radius: 0.35,
      speed: 0.75,
      attack: {
        kind: 'melee',
        windup: 42,
        activeEnd: 46,
        total: 72,
        range: 1.25,
        halfAngle: 1.1,
        damage: 20,
      },
      visual: 'ossuary-thrall',
    },
  ],
  areas: [
    ...contentDefinitions.areas,
    ...developerScenes.map((s) => s.area),
    ...(
      [
        ['abandoned-orchard', 'orchard-fixture'],
        ['forest-gathering-clearing', 'clearing-fixture'],
        ['ruined-forge', 'forge-fixture'],
        ['desecrated-chapel', 'chapel-fixture'],
      ] as const
    ).map(([id, fixture]) => fixtureCopy(id, fixture)),
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
