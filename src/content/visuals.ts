export { assetCatalog } from './asset-catalog';
import { clipForState } from './gameplay';
export type ActorVisualDefinition = {
  id: string;
  asset: string;
  clips: Record<keyof typeof clipForState, string>;
  attacks: readonly string[];
  tint: number;
};
export const actorVisuals: Readonly<Record<string, ActorVisualDefinition>> = {
  hero: {
    id: 'hero',
    asset: 'ink-hero-current',
    clips: { ...clipForState },
    attacks: ['sweep', 'lunge'],
    tint: 0xffffff,
  },
  skeleton: {
    id: 'skeleton',
    asset: 'ink-skeleton',
    clips: Object.fromEntries(
      Object.keys(clipForState).map((state) => [state, 'rest']),
    ) as ActorVisualDefinition['clips'],
    attacks: ['rest'],
    tint: 0xffffff,
  },
};
