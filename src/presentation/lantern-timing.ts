import type { Clip } from '../assets/schema';
import type { AuthoredHeading } from '../content/headings';
import { lanternTiming } from '../content/hero-actions';
const cache = new WeakMap<Clip, Clip>();
// Reuse delivered drawings; the shared authored timeline owns the shorter lift.
export function retimeLanternClip(clip: Clip, heading: AuthoredHeading): Clip {
  const cached = cache.get(clip);
  if (cached) return cached;
  const holds = lanternTiming(heading).holdsMs;
  if (holds.length !== clip.frames.length)
    throw new Error('Lantern timing does not match drawings');
  const remap = (time: number) => {
    let from = 0,
      to = 0;
    for (let i = 0; i < holds.length; i++) {
      const old = clip.durationsMs[i]!,
        next = holds[i]!;
      if (time <= from + old + 1e-7) return to + (Math.max(0, time - from) / old) * next;
      from += old;
      to += next;
    }
    return to;
  };
  const result = {
    ...clip,
    durationsMs: [...holds],
    notifies: clip.notifies.map((n) => ({ ...n, atMs: remap(n.atMs) })),
  };
  cache.set(clip, result);
  return result;
}
