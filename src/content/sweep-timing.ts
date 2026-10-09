import type { AuthoredHeading } from '../core/camera';

type Preset = {
  label: string;
  description: string;
  ticks?: Record<AuthoredHeading, readonly number[]>;
  damage?: readonly [number, number];
  effect?: { lead: number; hold: number; tail: number };
};
export const sweepTimingPresets = {
  baseline: {
    label: 'Baseline · 300 / 900 ms',
    description: 'Original authored timing and linear effect playback.',
  },
  snap: {
    label: 'A · Snap · 200 / 700 ms',
    description: 'Shorter wind-up, quick release and a crisp finish.',
    ticks: {
      d90: [1, 2, 2, 6, 1, 2, 4, 5, 5, 4, 10],
      d00: [1, 2, 2, 7, 2, 4, 5, 5, 5, 4, 5],
      d270: [1, 2, 2, 7, 2, 4, 5, 7, 6, 6],
      d180: [1, 2, 2, 7, 2, 4, 5, 7, 6, 6],
    },
    damage: [12, 18],
    effect: { lead: 6, hold: 1, tail: 5 },
  },
  weight: {
    label: 'B · Weight · 250 / 800 ms',
    description: 'Coil into the attack, hold the contact pose, then whip through.',
    ticks: {
      d90: [1, 2, 3, 8, 1, 4, 2, 6, 6, 5, 10],
      d00: [1, 2, 3, 9, 4, 2, 6, 6, 5, 5, 5],
      d270: [1, 2, 3, 9, 4, 2, 6, 8, 7, 6],
      d180: [1, 2, 3, 9, 4, 2, 6, 8, 7, 6],
    },
    damage: [15, 21],
    effect: { lead: 8, hold: 3, tail: 6 },
  },
  quick: {
    label: 'C · Quick · 167 / 600 ms',
    description: 'Immediate response, a fast slash and a shorter return to ready.',
    ticks: {
      d90: [1, 1, 2, 5, 1, 2, 4, 4, 4, 4, 8],
      d00: [1, 1, 2, 6, 2, 4, 4, 4, 4, 4, 4],
      d270: [1, 1, 2, 6, 2, 4, 4, 6, 5, 5],
      d180: [1, 1, 2, 6, 2, 4, 4, 6, 5, 5],
    },
    damage: [10, 16],
    effect: { lead: 4, hold: 0, tail: 6 },
  },
} as const satisfies Record<string, Preset>;
export type SweepTiming = keyof typeof sweepTimingPresets;
const timingOverrides = new Map<string, { holdsMs: number[]; damageMs: number[] }>();
for (const [id, preset] of Object.entries(sweepTimingPresets)) {
  const recipe: Preset = preset;
  if (!recipe.ticks || !recipe.damage) continue;
  for (const [heading, ticks] of Object.entries(recipe.ticks))
    timingOverrides.set(`${id}:${heading}`, {
      holdsMs: ticks.map((t) => (t * 1000) / 60),
      damageMs: recipe.damage.map((t) => (t * 1000) / 60),
    });
}
export function sweepTimingOverride(timing: SweepTiming, heading: AuthoredHeading) {
  return timingOverrides.get(`${timing}:${heading}`);
}
export function sweepEffectTiming(timing: SweepTiming) {
  const recipe: Preset = sweepTimingPresets[timing];
  return recipe.effect;
}
export function sweepEffectPhase(timing: SweepTiming, elapsedMs: number) {
  const recipe = sweepEffectTiming(timing);
  if (!recipe) throw new Error('Baseline sweep uses its authored effect clock');
  const ticks = (elapsedMs * 60) / 1000;
  if (ticks < recipe.lead) return 0.5 * (ticks / recipe.lead) ** 2;
  if (ticks < recipe.lead + recipe.hold) return 0.5;
  return Math.min(1, 0.5 + (0.5 * (ticks - recipe.lead - recipe.hold)) / recipe.tail);
}

export type SweepRecovery = 'authored' | 'ready' | 'clean';
export const sweepRecoveryOptions = {
  authored: 'Original ending',
  ready: 'Canonical final pose',
  clean: 'Clean settle to idle',
} as const;

export const defaultSweepTiming: SweepTiming = 'quick';
export const defaultSweepRecovery: SweepRecovery = 'ready';
