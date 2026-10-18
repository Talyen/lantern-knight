import { heroActionTiming, heroCelTick, type HeroAttackKind } from './hero-actions';
import type { SweepTiming } from './sweep-timing';
import type { AuthoredHeading } from './headings';
import type { AttackDefinition } from './world';
export const tuning = {
  cameraFollow: true,
  tickHz: 60,
  moveSpeed: 3.9,
  heroVisualScale: 1.1,
  heroRadius: 0.25,
  heroMaxHealth: 100,
  attack: { ...heroActionTiming('sweep', 'd90'), range: 1.65, halfAngle: 0.95, damage: 26 },
  sweepRange: 2.15,
  sweepHalfAngle: Math.PI / 2,
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
    cooldown: 240,
    range: 3.25,
    damage: 16,
    stun: 30,
    recoilDistance: 0.75,
    recoilTicks: 12,
    burnDuration: 180,
    burnCadence: 60,
    burnDamage: 4,
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
  sweepTiming?: SweepTiming;
  actionHeading: AuthoredHeading;
  definition: {
    attack: AttackDefinition;
  };
}) {
  const attack = actor.definition.attack;
  return actor.kind === 'hero'
    ? {
        ...tuning.attack,
        damage: actor.definition.attack.damage,
        range:
          actor.attackKind === 'sweep'
            ? attack.kind === 'melee'
              ? (attack.sweepRange ?? attack.range)
              : attack.range
            : actor.definition.attack.range,
        ...heroActionTiming(actor.attackKind, actor.actionHeading, actor.sweepTiming),
        clip: actor.attackKind,
        halfAngle: actor.attackKind === 'sweep' ? tuning.sweepHalfAngle : 0.35,
      }
    : { ...attack, halfAngle: attack.kind === 'melee' ? attack.halfAngle : 0 };
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
// Milliseconds relative to the authoritative damage pulse.
export function flareLightEnvelope(ms: number) {
  if (ms < -100 || ms >= 250) return 0;
  if (ms < 0) return (ms + 100) / 100;
  return (1 - ms / 250) ** 2;
}
