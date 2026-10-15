import type { Heading } from './headings';
import type { Clip } from '../assets/schema';

// Plant drawings in the supplied run cycles, in native drawing order.
export const heroFootContacts: Record<Heading, readonly number[]> = {
  d00: [0, 4],
  d45: [0, 3],
  d90: [0, 4],
  d135: [0, 4],
  d180: [0, 4],
  d225: [0, 4],
  d270: [0, 4],
  d315: [0, 4],
};
const versions = new WeakMap<Clip, Map<Heading, Clip>>();
export function footstepClip(clip: Clip, heading: Heading): Clip {
  let headings = versions.get(clip);
  if (!headings) versions.set(clip, (headings = new Map()));
  let result = headings.get(heading);
  if (!result) {
    result = {
      ...clip,
      notifies: [
        ...clip.notifies.filter((n) => n.kind !== 'footstep'),
        ...heroFootContacts[heading].map((frame, i) => ({
          id: `foot-${i}`,
          kind: 'footstep' as const,
          atMs: clip.durationsMs.slice(0, frame).reduce((a, b) => a + b, 0),
        })),
      ],
    };
    headings.set(heading, result);
  }
  return result;
}
