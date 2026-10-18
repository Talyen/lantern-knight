export const combatFeedback = {
  ribLane: { asset: 'library-combat-candlebone-rib-lane', clip: 'show' },
  flare: {
    asset: 'library-animation-09492a7b61152c09-b72d9dc365fb',
    clip: 'lantern_flare_fx',
    sourceOrigin: [1130, 400],
    scale: 0.8,
  },
  lunge: { asset: 'library-combat-wickline-thrust', clip: 'show', scale: 1.0 },
  dodge: { asset: 'library-dash_wake', scale: 0.3 },
  dodgeLeaves: {
    asset: 'library-animation-b65209c1cfb1b9d5-246e63be11f4',
    clip: '05_footstep_leaves',
    scale: 0.65,
  },
  contact: {
    asset: 'library-blocked_contact_shear',
    clip: 'blocked_contact_shear',
    scale: 0.9,
    height: 0.75,
  },
  sweep: {
    asset: 'library-sword_finisher_03',
    scale: { d00: 1.2, d90: 1.1, d180: 0.98, d270: 0.98 },
    forward: 0.2,
    height: 0.15,
    leadTicks: 12,
    durationMs: 400,
    reverse: true,
    // Effect headings are screen-oriented; the locked camera has a 45° azimuth.
    headingOffsetDegrees: 45,
  },
} as const;
export const combatEffectCatalog = Object.fromEntries(
  Object.values(combatFeedback)
    .map(({ asset }) => asset)
    .map((id) => [id, `generated/library/${id}/manifest.json`]),
);
// Rib lanes belong to rooms with casters, not the hero’s shared action kit.
export const combatEffectAssets = Object.entries(combatFeedback)
  .filter(([kind]) => kind !== 'ribLane')
  .map(([, effect]) => effect.asset);
