import { retimeClip } from '../core/animation';
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
  const result = retimeClip(clip, holds);
  cache.set(clip, result);
  return result;
}
