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
  placeholder: 'generated/manifest.json',
  ...Object.fromEntries(['ink-crypt-stone','ink-crypt-damp','ink-crypt-marble','ink-crypt','ink-crypt-wall','ink-crypt-flame','ink-crypt-ambient','ink-crypt-feature'].map(id=>[id,`generated/ink/${id}/manifest.json`])),
  ...Object.fromEntries(['ink-hero-current','ink-hero','ink-skeleton','ink-revenant','ink-hero-idle-study','ink-scenery','ink-chapel-front','ink-blackwood-oak','ink-blackwood-woodland','ink-churchyard-roof','ink-boundary','ink-graveyard-scenery','ink-graveyard-overlays','ink-graveyard-materials','ink-ambient','ink-rest','ink-soil','ink-floor-court','ink-floor-landing','ink-moss','ink-masonry','ink-wood','ink-decals','ink-ground-transitions','ink-wall-face','ink-combat-study','ink-combat','ink-cues'].map(id=>[id,`generated/ink/${id}/manifest.json`])),
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
  warden: {
    id: 'warden',
    asset: 'ink-revenant',
    clips: Object.fromEntries(Object.keys(clipForState).map(state=>[state,'rest'])) as ActorVisualDefinition['clips'],
    attacks: ['rest'],
    tint: 0xffffff,
  },
};

export const gameAssetCatalog=Object.fromEntries(Object.entries(assetCatalog).filter(([id])=>!['placeholder','ink-hero','ink-combat-study','ink-revenant','ink-hero-idle-study','ink-wall-face','ink-wood','ink-rest','ink-boundary','ink-floor-court','ink-floor-landing'].includes(id)));
