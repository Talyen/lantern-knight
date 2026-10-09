import type { Clip } from '../assets/schema';
import type { AuthoredHeading } from '../core/camera';
import {
  defaultSweepRecovery,
  sweepTimingOverride,
  type SweepTiming,
  type SweepRecovery,
} from '../content/sweep-timing';
const cache = new WeakMap<Clip, Map<string, Clip>>();
export function retimeSweepClip(
  clip: Clip,
  timing: SweepTiming,
  recovery: SweepRecovery = defaultSweepRecovery,
  readyFrame?: string,
): Clip {
  const heading = clip.frames[0]!.split('-')[1] as AuthoredHeading,
    recipe = sweepTimingOverride(timing, heading);
  const cleanEnding = heading === 'd90' && recovery !== 'authored';
  if (timing === 'baseline' && !cleanEnding) return clip;
  if (timing !== 'baseline' && (!recipe || recipe.holdsMs.length !== clip.frames.length))
    throw new Error(`Sweep timing does not match authored drawings: ${timing}/${heading}`);
  if (cleanEnding && !readyFrame) throw new Error('Sweep recovery requires a canonical idle frame');
  const holds = recipe?.holdsMs ?? clip.durationsMs,
    key = `${timing}:${recovery}:${readyFrame}`;
  let versions = cache.get(clip);
  if (!versions) {
    versions = new Map();
    cache.set(clip, versions);
  }
  let result = versions.get(key);
  if (result) return result;
  const remap = (time: number) => {
    let from = 0,
      to = 0;
    for (let i = 0; i < clip.durationsMs.length; i++) {
      const hold = clip.durationsMs[i]!,
        next = holds[i]!;
      if (time <= from + hold + 1e-7) return to + Math.max(0, (time - from) / hold) * next;
      from += hold;
      to += next;
    }
    return to;
  };
  result = {
    ...clip,
    frames: clip.frames.map((frame, index) => {
      if (!cleanEnding) return frame;
      if (index === clip.frames.length - 1) return readyFrame!;
      // Settle in the actual follow-through, rather than replaying a wind-up drawing.
      if (recovery === 'clean' && index === clip.frames.length - 2)
        return clip.frames[clip.frames.length - 3]!;
      return frame;
    }),
    durationsMs: [...holds],
    notifies: clip.notifies.map((notify) => ({ ...notify, atMs: remap(notify.atMs) })),
  };
  versions.set(key, result);
  return result;
}
