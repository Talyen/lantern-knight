import { ContentRegistry } from '../../src/content/world';
import { actors } from '../../src/content/actors';
import { GameSession } from '../../src/core/session';

export function upgradeFixture(area = 'camp') {
  const registry = new ContentRegistry({
    initialArea: area,
    player: 'lamplighter',
    actors: actors.map((a) => (a.kind === 'enemy' ? { ...a, maxHealth: 1000 } : a)),
    areas: [
      {
        id: area,
        name: 'Independent camp',
        subtitle: '',
        seedOffset: 0,
        floorColor: 0,
        bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
        surface: { kind: 'flat', height: 0 },
        baselineEntry: 'start',
        entries: [
          { id: 'start', x: 0, z: 0 },
          { id: 'fire-arrival', x: 0, z: 0 },
          { id: 'fire-rest', x: -5, z: 0 },
        ],
        props: [],
        exits: [],
        campfires: [
          { id: 'arrival', name: 'Arrival fire', x: 0, z: 0, safeRadius: 2 },
          { id: 'rest', name: 'Fixture fire', x: -5, z: 0, safeRadius: 2, discovered: true },
        ],
        spawns: [
          { id: 'guard', actor: 'skeleton', x: 4, z: 0, awareness: { radius: 1, leash: 2 } },
        ],
        interactables: [
          {
            id: 'cache',
            object: 'cache',
            kind: 'container',
            x: 1,
            z: 0,
            rewards: [
              { item: 'gold', amount: 20 },
              { item: 'iron', amount: 6 },
            ],
            idle: 'idle',
            action: 'open',
            spent: 'looted',
          },
        ],
      },
    ],
  });
  return new GameSession(registry);
}
export function supplyUpgrades(session: GameSession) {
  const save = session.captureSave();
  delete save.adventure!.pack;
  Object.assign(save.adventure!.inventory, { gold: 28, iron: 10 });
  session.restoreSave(save);
}
