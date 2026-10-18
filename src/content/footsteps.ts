import type { Heading } from './headings';
import type { Clip } from '../assets/schema';

// Plant drawings in the supplied run cycles, in native drawing order.
// Only the diagonal approach uses an earlier contact; all other headings share it.
export const heroFootContacts: Record<Heading, readonly number[]> = {
  d45: [0, 3],
  d00: [0, 4],
  d90: [0, 4],
  d135: [0, 4],
  d180: [0, 4],
  d225: [0, 4],
  d270: [0, 4],
  d315: [0, 4],
};
export function footstepClip(clip: Clip, heading: Heading): Clip {
  return {
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
}
