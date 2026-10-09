import { defaultSweepTiming, sweepTimingOverride, type SweepTiming } from './sweep-timing';
import timings from '../../authoring/hero-actions.json';
import type { AuthoredHeading, Heading } from '../core/camera';
export type HeroAttackKind = 'sweep' | 'lunge';
export type HeroTiming = { holdsMs: number[]; damageMs?: number[]; pulseMs?: number };
export const heroTimings = timings as Record<
  string,
  Record<AuthoredHeading, HeroTiming> & Partial<Record<Heading, HeroTiming>>
>;
const tick = (ms: number) => Math.ceil((ms * 60) / 1000 - 1e-8);
export function heroActionTiming(
  clip: string,
  heading: AuthoredHeading,
  sweepTiming: SweepTiming = defaultSweepTiming,
) {
  const recipe: HeroTiming | undefined =
    (clip === 'sweep' ? sweepTimingOverride(sweepTiming, heading) : undefined) ??
    heroTimings[clip]?.[heading];
  if (!recipe) throw new Error(`Missing hero action timing: ${clip}/${heading}`);
  return {
    total: tick(recipe.holdsMs.reduce((sum, ms) => sum + ms, 0)),
    windup: tick(recipe.damageMs?.[0] ?? recipe.pulseMs ?? 0),
    activeEnd: tick(recipe.damageMs?.[1] ?? recipe.pulseMs ?? 0),
  };
}

export function heroCelTick(clip: string, celIndex: number, heading: AuthoredHeading = 'd90') {
  return tick(
    heroTimings[clip]![heading]!.holdsMs.slice(0, celIndex).reduce((sum, ms) => sum + ms, 0),
  );
}
