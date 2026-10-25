import { tuning } from './gameplay';

// Supplied library drawings only. Contact markers bind formation and release to
// the simulation's strike tick; tail ticks control the visible aftermath.
export type CombatEffectBinding = {
  readonly asset: string;
  readonly clip: string;
  readonly scale: number;
  readonly height: number;
  readonly forward: number;
  readonly leadTicks: number;
  readonly tailTicks: number;
  readonly contactMs?: number;
  readonly orient?: boolean;
  readonly axisDegrees?: number;
  readonly directional?: boolean;
  readonly attachment?: 'sword' | 'lantern' | 'travel';
  readonly tint?: number;
};
export const combatFeedback = {
  sweepEdge: {
    asset: 'library-sword_arc_02',
    clip: 'sword_arc_02',
    scale: 1.05,
    height: 0.25,
    forward: 0.15,
    leadTicks: 4,
    tailTicks: 10,
    directional: true,
    contactMs: 165,
  },
  lunge: {
    asset: 'library-combat-wickline-thrust',
    clip: 'show',
    scale: 1.9,
    height: 0.8,
    forward: 0.35,
    leadTicks: 6,
    tailTicks: 18,
    orient: true,
    attachment: 'sword',
  },
  lungeBurst: {
    asset: 'library-combat-gutter-spark',
    clip: 'show',
    scale: 1.4,
    height: 0.8,
    forward: 0.2,
    leadTicks: 5,
    tailTicks: 22,
    orient: true,
    attachment: 'sword',
  },
  flare: {
    asset: 'library-animation-31cc2e4e941e9c27-14c5aeddfa12',
    clip: 'animation',
    // The supplied halo covered a 2.5-unit radius at scale 3.5.
    scale: (3.5 / 2.5) * tuning.ability.range,
    height: 0,
    forward: 0,
    leadTicks: 12,
    tailTicks: 34,
    contactMs: 920,
    tint: 0xffbc55,
  },
  flareRays: {
    asset: 'library-animation-9a44ec55322f9a22-c01bc597592f',
    clip: 'animation',
    scale: 1.0,
    height: 0,
    forward: 0,
    leadTicks: 6,
    tailTicks: 22,
    attachment: 'lantern',
    contactMs: 120,
    tint: 0xffe0a0,
  },
  enemySwipe: {
    asset: 'library-combat-ivory-rake',
    clip: 'show',
    scale: 1.4,
    height: 0.85,
    forward: 0.2,
    leadTicks: 10,
    tailTicks: 22,
    orient: true,
  },
  enemySlam: {
    asset: 'library-combat-rust-crescent',
    clip: 'show',
    scale: 2.0,
    height: 0.02,
    forward: 0.8,
    leadTicks: 20,
    tailTicks: 30,
  },
  enemyDust: {
    asset: 'library-combat-grave-dust-bloom',
    clip: 'show',
    scale: 1.3,
    height: 0.05,
    forward: 0.8,
    leadTicks: 0,
    tailTicks: 32,
    contactMs: 70,
  },
  contact: {
    asset: 'library-neutral_contact_snap',
    clip: 'neutral_contact_snap',
    scale: 1.3,
    height: 0.85,
    forward: 0,
    leadTicks: 0,
    tailTicks: 10,
    contactMs: 17,
    orient: true,
    axisDegrees: 45,
  },
  contactBone: {
    asset: 'library-combat-ivory-rupture',
    clip: 'show',
    scale: 0.7,
    height: 0.85,
    forward: 0,
    leadTicks: 0,
    tailTicks: 18,
    contactMs: 60,
  },
  contactArmor: {
    asset: 'library-amber_impact',
    clip: 'amber_impact__unoriented',
    scale: 1.3,
    height: 1.0,
    forward: 0,
    leadTicks: 0,
    tailTicks: 14,
    contactMs: 33,
  },
  contactBurn: {
    asset: 'library-combat-pilgrims-brand',
    clip: 'show',
    scale: 1.9,
    height: 0.8,
    forward: 0,
    leadTicks: 0,
    tailTicks: 20,
  },
  dodge: {
    asset: 'library-dash_wake',
    clip: 'dash_wake',
    scale: 0.7,
    height: 0.08,
    forward: 0,
    leadTicks: 0,
    tailTicks: 10,
    contactMs: 0,
    directional: true,
    attachment: 'travel',
  },
  dodgeLeaves: {
    asset: 'library-animation-b65209c1cfb1b9d5-246e63be11f4',
    clip: '05_footstep_leaves',
    scale: 0.8,
    height: 0,
    forward: 0,
    leadTicks: 0,
    tailTicks: 22,
    contactMs: 0,
  },
} as const satisfies Record<string, CombatEffectBinding>;
export const ribLaneEffect = { asset: 'library-combat-candlebone-rib-lane', clip: 'show' } as const;
export const combatEffectCatalog = Object.fromEntries(
  [...Object.values(combatFeedback), ribLaneEffect].map(({ asset }) => [
    asset,
    `generated/library/${asset}/manifest.json`,
  ]),
);
// Actor spells are acquired by their rooms, separately from the shared combat kit.
export const combatEffectAssets = Object.values(combatFeedback).map(({ asset }) => asset);

// Native authoring manifests remain authoritative; Game consumes prepared,
// lossless packed copies of these frequently resident effect drawings.
export const packedCombatEffects: readonly string[] = [
  combatFeedback.dodge.asset,
  combatFeedback.sweepEdge.asset,
];
export const packedCombatManifest = (id: string) => `generated/game-effects/${id}/manifest.json`;
