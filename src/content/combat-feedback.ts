export const combatFeedback = {
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
  [combatFeedback.contact.asset, combatFeedback.sweep.asset].map((id) => [
    id,
    `generated/library/${id}/manifest.json`,
  ]),
);
export const combatEffectAssets = Object.keys(combatEffectCatalog);
