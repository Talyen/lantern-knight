export { assetCatalog } from './asset-catalog';
import { clipForState, tuning } from './gameplay';
export type ActorVisualDefinition = {
  id: string;
  asset: string;
  clips: Record<keyof typeof clipForState, string>;
  attacks: readonly string[];
  // One-based supplied drawing that first shows weapon contact.
  attackContactDrawing?: number;
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
    asset: 'library-sk02',
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
    attackContactDrawing: 4,
    tint: 0xffffff,
    scale: 1.35,
  },
};
