import {clipForState, swordCombo} from './gameplay';
export type ActorVisualDefinition = {
  id: string;
  asset: string;
  clips: Record<keyof typeof clipForState, string>;
  attacks: readonly string[];
  tint: number;
};
export const assetCatalog: Readonly<Record<string, string>> = {
  placeholder: 'generated/manifest.json',
};
export const actorVisuals: Readonly<Record<string, ActorVisualDefinition>> = {
  hero: {
    id: 'hero',
    asset: 'placeholder',
    clips: clipForState,
    attacks: swordCombo.map((s) => s.clip),
    tint: 0xffffff,
  },
  warden: {
    id: 'warden',
    asset: 'placeholder',
    clips: Object.fromEntries(
      Object.entries(clipForState).map(([state, clip]) => [
        state,
        `enemy_${clip}`,
      ]),
    ) as Record<keyof typeof clipForState, string>,
    attacks: ['enemy_attack_sword_01'],
    tint: 0xbd8d88,
  },
};
