import { tuning } from './gameplay';
import type { ContentDefinitions } from './world';
export const actors = [
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
] satisfies ContentDefinitions['actors'];
