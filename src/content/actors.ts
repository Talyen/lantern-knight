import { tuning } from './gameplay';
import type { ContentDefinitions } from './world';
export const actors = [
  {
    // Preserve the actor ID used by existing scenes and checkpoints.
    id: 'skeleton',
    kind: 'enemy',
    maxHealth: 50,
    radius: 0.25,
    speed: 0.9,
    melee: { windup: 39, activeEnd: 43, total: 68, range: 1.2, halfAngle: 1.1, damage: 8 },
    visual: 'ossuary-thrall',
  },
  {
    id: 'chapel-warden',
    kind: 'enemy',
    poise: true,
    maxHealth: 130,
    radius: 0.34,
    speed: 0.65,
    melee: { windup: 60, activeEnd: 66, total: 108, range: 1.6, halfAngle: 1.3, damage: 18 },
    visual: 'chapel-warden',
  },
  {
    id: 'chapel-attendant',
    kind: 'enemy',
    maxHealth: 50,
    radius: 0.25,
    speed: 1.2,
    melee: { windup: 32, activeEnd: 36, total: 62, range: 1.2, halfAngle: 1.1, damage: 8 },
    visual: 'ossuary-thrall',
  },
  {
    id: 'lamplighter',
    kind: 'hero',
    maxHealth: tuning.heroMaxHealth,
    radius: tuning.heroRadius,
    speed: tuning.moveSpeed,
    melee: { ...tuning.attack, sweepRange: tuning.sweepRange },
    visual: 'hero',
  },
] satisfies ContentDefinitions['actors'];
