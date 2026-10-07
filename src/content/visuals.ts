import {visualEffectsCatalog} from './visual-effects-assets';
import {clipForState} from './gameplay';
export type ActorVisualDefinition = {
  id: string;
  asset: string;
  clips: Record<keyof typeof clipForState, string>;
  attacks: readonly string[];
  tint: number;
};
export const assetCatalog: Readonly<Record<string, string>> = {
  ...visualEffectsCatalog,
  ...Object.fromEntries(['ink-crypt-stone','ink-crypt-damp','ink-crypt-marble','ink-crypt','ink-crypt-wall','ink-crypt-flame','ink-crypt-ambient','ink-crypt-feature'].map(id=>[id,`generated/ink/${id}/manifest.json`])),
  ...Object.fromEntries(['ink-hero-current','ink-skeleton','ink-scenery','ink-chapel-front','ink-blackwood-oak','ink-blackwood-woodland','ink-churchyard-roof','ink-graveyard-scenery','ink-graveyard-overlays','ink-graveyard-materials','ink-ambient','ink-soil','ink-moss','ink-masonry','ink-decals','ink-ground-transitions','ink-cues'].map(id=>[id,`generated/ink/${id}/manifest.json`])),
};
export const actorVisuals: Readonly<Record<string, ActorVisualDefinition>> = {
  hero: {
    id: 'hero',
    asset: 'ink-hero-current',
    clips: {...clipForState},
    attacks: ['sweep','lunge'],
    tint: 0xffffff,
  },
  skeleton: {id:'skeleton',asset:'ink-skeleton',clips:Object.fromEntries(Object.keys(clipForState).map(state=>[state,'rest'])) as ActorVisualDefinition['clips'],attacks:['rest'],tint:0xffffff},

};

export const gameAssetCatalog=assetCatalog;
