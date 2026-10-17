import { HEADINGS } from '../content/headings';
import type { Manifest, Clip } from './schema';

function clipKey(manifest: Manifest, id: string) {
  const { clips, fallbacks } = manifest.asset;
  return Object.hasOwn(clips, id) ? id : Object.hasOwn(fallbacks, id) ? fallbacks[id]! : id;
}

export function resolveClip(
  manifest: Manifest,
  id: string,
  heading: (typeof HEADINGS)[number],
): Clip {
  const key = clipKey(manifest, id);
  const direction =
    manifest.asset.viewMode === 'fixed-authored'
      ? 'd45'
      : manifest.asset.viewMode === 'four-directional' ||
          (manifest.asset.viewMode === 'mixed-directional' && key !== 'walk')
        ? HEADINGS[(Math.floor((HEADINGS.indexOf(heading) + 1) / 2) * 2) % 8]!
        : heading;
  const clip = manifest.asset.clips[key]?.[direction];
  if (!clip) throw new Error(`required clip unavailable: ${manifest.asset.id}/${id}/${direction}`);
  return clip;
}
// Supplied actor kits may provide different facings for each action. Select a
// delivered drawing without mirroring; authored scene placements stay strict.
export function resolveActorClip(
  manifest: Manifest,
  id: string,
  heading: (typeof HEADINGS)[number],
): Clip {
  if (manifest.asset.viewMode !== 'supplied') return resolveClip(manifest, id, heading);
  const key = clipKey(manifest, id),
    directions = manifest.asset.clips[key],
    requested = HEADINGS.indexOf(heading),
    distance = (candidate: (typeof HEADINGS)[number]) => {
      const delta = Math.abs(HEADINGS.indexOf(candidate) - requested);
      return Math.min(delta, HEADINGS.length - delta);
    },
    available = HEADINGS.filter((candidate) => directions?.[candidate]);
  available.sort((a, b) => distance(a) - distance(b));
  return resolveClip(manifest, id, available[0] ?? heading);
}
