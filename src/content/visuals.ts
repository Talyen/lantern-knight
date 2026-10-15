export { assetCatalog } from './asset-catalog';
import { clipForState, tuning } from './gameplay';
export type ActorVisualDefinition = {
  id: string;
  asset: string;
  clips: Record<keyof typeof clipForState, string>;
  attacks: readonly string[];
  tint: number;
  scale?: number;
};
export const actorVisuals: Readonly<Record<string, ActorVisualDefinition>> = {
  hero: {
    id: 'hero',
    asset: 'ink-hero-current',
    clips: { ...clipForState },
    attacks: ['sweep', 'lunge'],
    tint: 0xffffff,
    scale: tuning.heroVisualScale,
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
  'chapel-warden': {
    id: 'chapel-warden',
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
    tint: 0xe1b6ba,
    scale: 1.35,
  },
};
