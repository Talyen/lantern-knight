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
  'ossuary-thrall': {
    id: 'ossuary-thrall',
    asset: 'library-sk01',
    clips: {
      idle: 'idle',
      walk: 'move',
      attack: 'attack',
      dodge: 'move',
      ability: 'idle',
      hurt: 'hit',
      death: 'defeat',
    },
    attacks: ['attack', 'attack'],
    tint: 0xffffff,
  },
};
