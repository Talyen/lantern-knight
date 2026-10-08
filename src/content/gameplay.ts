import { heroActionTiming, heroCelTick, type HeroAttackKind } from './hero-actions';
import type { AuthoredHeading } from '../core/camera';
export const tuning = {
  cameraFollow: true,
  tickHz: 60,
  moveSpeed: 1.8,
  heroRadius: 0.25,
  heroMaxHealth: 100,
  attack: { ...heroActionTiming('sweep', 'd90'), range: 1.65, halfAngle: 0.95, damage: 26 },
  inputBufferTicks: 8,
  dashBufferTicks: 5,
  deathHoldTicks: heroActionTiming('death', 'd90').total,
  enemyDeathHoldTicks: 45,
  maxCombatHeightDifference: 0.65,
  dodge: {
    total: heroActionTiming('dodge', 'd90').total,
    invulnerableStart: heroCelTick('dodge', 3),
    invulnerableEnd: heroCelTick('dodge', 5),
    travelStart: heroCelTick('dodge', 3),
    travelEnd: heroCelTick('dodge', 5),
    speed: (2.1 * 60) / (heroCelTick('dodge', 5) - heroCelTick('dodge', 3)),
    cooldown: 50,
    facing: 'travel-or-aim',
  },
  ability: {
    windup: heroActionTiming('cast_lantern_flare', 'd90').windup,
    total: heroActionTiming('cast_lantern_flare', 'd90').total,
    cooldown: 180,
    range: 3,
    halfAngle: 0.55,
    damage: 16,
    stun: 30,
  },
  hurt: { total: heroActionTiming('hit', 'd90').total },
  enemyHurt: { total: 10 },
  enemy: {
    maxHealth: 70,
    speed: 1.15,
    windup: 30,
    activeEnd: 34,
    total: 58,
    range: 1.05,
    damage: 12,
  },
  room: { halfSize: 7.5 },
} as const;
export function attackDefinition(actor: {
  kind: 'hero' | 'enemy';
  attackKind: HeroAttackKind;
  actionHeading: AuthoredHeading;
  definition: {
    melee: {
      windup: number;
      activeEnd: number;
      total: number;
      range: number;
      halfAngle: number;
      damage: number;
    };
  };
}) {
  return actor.kind === 'hero'
    ? {
        ...tuning.attack,
        ...heroActionTiming(actor.attackKind, actor.actionHeading),
        clip: actor.attackKind,
        halfAngle: actor.attackKind === 'sweep' ? 0.95 : 0.35,
      }
    : actor.definition.melee;
}
export const clipForState = {
  idle: 'idle',
  walk: 'walk',
  attack: 'sweep',
  dodge: 'dodge',
  ability: 'cast_lantern_flare',
  hurt: 'hit',
  death: 'death',
} as const;
