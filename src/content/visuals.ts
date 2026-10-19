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
  groundFootsteps?: boolean;
  // Omitted uses neutral contact and the supplied attack drawing alone.
  combatMaterial?: 'bone' | 'armor';
};
export const actorVisuals: Readonly<Record<string, ActorVisualDefinition>> = {
  'fallen-orchard-worker': {
    id: 'fallen-orchard-worker',
    asset: 'library-zb01',
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
  'orchard-feral-boar': {
    id: 'orchard-feral-boar',
    asset: 'library-orchard-feral-boar',
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
    attackContactDrawing: 2,
  },
  'rootbound-scarecrow': {
    id: 'rootbound-scarecrow',
    asset: 'library-orchard-rootbound-scarecrow',
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
    attackContactDrawing: 2,
  },
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
    combatMaterial: 'bone',
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
  'candlebone-oracle': {
    id: 'candlebone-oracle',
    combatMaterial: 'bone',
    groundFootsteps: false,
    asset: 'library-sk03',
    clips: {
      idle: 'move',
      walk: 'move',
      attack: 'attack',
      dodge: 'move',
      ability: 'move',
      hurt: 'hit',
      death: 'defeat',
    },
    attacks: ['attack', 'attack'],
    attackContactDrawing: 5,
    tint: 0xffffff,
  },
  'chapel-warden': {
    id: 'chapel-warden',
    combatMaterial: 'armor',
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
