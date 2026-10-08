import type { Clip } from '../assets/schema';
import { clipDuration } from './animation';
export const walkTimings = {
  supplied: { label: 'Authored holds', description: 'Imported locomotion timing.' },
  weighted: {
    label: 'Weighted walk',
    description:
      'Contact/loading holds with the original cycle length. Actions use directed timing.',
  },
} as const;
export type WalkTiming = keyof typeof walkTimings;
const cached = new WeakMap<Clip, Map<string, Clip>>();
export function timedWalk(clip: Clip, timing: WalkTiming, holds?: readonly number[]): Clip {
  if (timing === 'supplied' || !holds) return clip;
  if (
    holds.length !== clip.frames.length ||
    holds.some((n) => !Number.isFinite(n) || n <= 0) ||
    Math.abs(holds.reduce((a, b) => a + b, 0) - clipDuration(clip)) > 0.001
  )
    throw new Error('Weighted walk must preserve its authored cycle');
  const key = holds.join(','),
    versions = cached.get(clip) ?? new Map<string, Clip>();
  cached.set(clip, versions);
  let result = versions.get(key);
  if (!result) {
    result = { ...clip, durationsMs: [...holds] };
    versions.set(key, result);
  }
  return result;
}
export function remapWalkTime(from: Clip, to: Clip, time: number) {
  if (from.frames.length !== to.frames.length || from.frames.some((id, i) => id !== to.frames[i]))
    return from.loop && to.loop ? (Math.max(0, time) / clipDuration(from)) * clipDuration(to) : 0;
  const duration = clipDuration(from),
    loop = from.loop ? Math.floor(Math.max(0, time) / duration) : 0,
    t = from.loop ? Math.max(0, time) % duration : Math.min(Math.max(0, time), duration - 0.0001);
  let a = 0,
    b = 0;
  for (let i = 0; i < from.frames.length; i++) {
    const hold = from.durationsMs[i]!;
    if (t < a + hold) return loop * clipDuration(to) + b + ((t - a) / hold) * to.durationsMs[i]!;
    a += hold;
    b += to.durationsMs[i]!;
  }
  return b;
}
