import { HEADINGS, type Heading } from './headings';

// Supplied compass labels describe screen space under the locked camera.
export const heroScreenDirections: Readonly<Record<Heading, string>> = {
  d00: 'DL',
  d45: 'D',
  d90: 'DR',
  d135: 'R',
  d180: 'UR',
  d225: 'U',
  d270: 'UL',
  d315: 'L',
};
export const heroTravelClips = HEADINGS.map((heading) => `travel_${heading}`);
const heroTravelSet = new Set<string>(heroTravelClips);
export function heroTravelClip(heading: Heading) {
  return `travel_${heading}`;
}
export function isHeroLocomotion(id: string) {
  return id === 'walk' || heroTravelSet.has(id);
}
