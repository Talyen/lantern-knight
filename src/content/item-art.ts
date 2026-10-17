// Existing library artwork, selected explicitly so Game ships only these drawings.
export const itemArt: Readonly<Record<string, string>> = {
  gold: 'library-lantern_concept_item_12_coin_purse',
  iron: 'library-lantern_resource_concept_02_iron_ingot_stack',
  bone: 'library-crypt_restrained_bone_pile_01',
  'workshop-temper': 'library-lantern_resource_concept_06_slate_whetstone',
  'health-potion': 'library-lantern_concept_item_10_crimson_restorative',
  'damaged-axe': 'library-lantern_drop_concept_03_bearded_handaxe',
  'damaged-helmet': 'library-lantern_drop_concept_08_watch_helm',
  'travellers-charm': 'library-lantern_ritual_prop_06_wax_seal_kit',
  'gatherers-seal': 'library-lantern_drop_concept_10_ashen_reliquary',
  'orchard-ring': 'library-lantern_concept_item_15_ember_signet_ring',
  'vigil-amulet': 'library-lantern_concept_item_09_mourning_medallion',
  'leather-armor': 'library-artwork-ui-equipment-icons-v1',
  'cloth-armor': 'library-artwork-ui-equipment-icons-v1',
  belt: 'library-artwork-ui-equipment-icons-v1',
  gloves: 'library-artwork-ui-equipment-icons-v1',
  boots: 'library-lantern_drop_concept_07_traveler_boots',
  amulet: 'library-lantern_concept_item_09_mourning_medallion',
  trinket: 'library-lantern_drop_concept_10_ashen_reliquary',
  sword: 'library-lantern_concept_item_01_oathsteel_sword',
  lantern: 'library-watch_lantern',
};
export const forgeArtwork =
  'library-artwork-environments-locations-ruined-craftsman-forge-ruined_craftsman_forge_native_1536x1024';
// Separate objects on the source sheet; the source pixels remain intact.
export const itemArtCrops: Readonly<Record<string, readonly [number, number, number, number]>> = {
  'leather-armor': [0.029506, 0.011962, 0.455343, 0.572568],
  'cloth-armor': [0.536683, 0.048644, 0.452153, 0.519139],
  gloves: [0.015949, 0.58453, 0.483254, 0.389952],
  belt: [0.535885, 0.641148, 0.445774, 0.301435],
};
export const interfaceFrameArtwork = 'library-artwork-ui-gothic-frame-v1';
export const forgeAnvilArtwork = 'library-furn_blacksmith_anvil_01';
export const itemArtAssets = [
  ...new Set([...Object.values(itemArt), forgeArtwork, forgeAnvilArtwork, interfaceFrameArtwork]),
];
