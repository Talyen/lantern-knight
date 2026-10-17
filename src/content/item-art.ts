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
  'ui-title': 'library-artwork-ui-title-emblem-v2',
  'ui-button': 'library-artwork-ui-button-frame-v2',
  'ui-icon-frame': 'library-artwork-ui-icon-frame-v2',
  'ui-health': 'library-artwork-ui-health-frame-v2',
  'ui-campfire': 'library-artwork-ui-campfire-emblem-v1',
  ...Object.fromEntries(
    [
      'move',
      'mouse',
      'sword',
      'lantern',
      'dodge',
      'hand',
      'bag',
      'potion',
      'pause',
      'display',
      'sound',
      'settings',
      'aim',
      'close',
      'more',
      'keycap',
    ].map((name) => [`ui-${name}`, 'library-artwork-ui-control-icons-v2']),
  ),
};
export const forgeArtwork =
  'library-artwork-environments-locations-ruined-craftsman-forge-ruined_craftsman_forge_native_1536x1024';
// Separate objects on the source sheet; the source pixels remain intact.
export const itemArtCrops: Readonly<Record<string, readonly [number, number, number, number]>> = {
  'leather-armor': [0.029506, 0.011962, 0.455343, 0.572568],
  'cloth-armor': [0.536683, 0.048644, 0.452153, 0.519139],
  gloves: [0.015949, 0.58453, 0.483254, 0.389952],
  belt: [0.535885, 0.641148, 0.445774, 0.301435],
  'ui-move': [0.029506, 0.044657, 0.23126, 0.236045],
  'ui-mouse': [0.3126, 0.063796, 0.150718, 0.212121],
  'ui-sword': [0.525518, 0.047049, 0.218501, 0.232855],
  'ui-lantern': [0.797448, 0.041467, 0.140351, 0.251994],
  'ui-dodge': [0.0311, 0.330144, 0.225678, 0.179426],
  'ui-hand': [0.296651, 0.328549, 0.178628, 0.188995],
  'ui-bag': [0.529506, 0.315789, 0.204147, 0.208931],
  'ui-potion': [0.791866, 0.316587, 0.145933, 0.204944],
  'ui-pause': [0.059011, 0.560606, 0.157895, 0.167464],
  'ui-display': [0.287879, 0.54386, 0.204147, 0.192982],
  'ui-sound': [0.527911, 0.568581, 0.198565, 0.170654],
  'ui-settings': [0.777512, 0.550239, 0.19378, 0.194577],
  'ui-aim': [0.050239, 0.760766, 0.19697, 0.195375],
  'ui-close': [0.308612, 0.77512, 0.168262, 0.165869],
  'ui-more': [0.526316, 0.828549, 0.205742, 0.064593],
  'ui-keycap': [0.793461, 0.784689, 0.161882, 0.165869],
};
export const interfaceFrameArtwork = 'library-artwork-ui-inventory-frame-v2';
export const archedFrameArtwork = 'library-artwork-ui-arched-frame-v2';
export const settingsFrameArtwork = 'library-artwork-ui-wide-frame-v2';
export const campfireFrameArtwork = 'library-artwork-ui-campfire-frame-v2';
export const forgeAnvilArtwork = 'library-furn_blacksmith_anvil_01';
export const itemArtAssets = [
  ...new Set([
    ...Object.values(itemArt),
    forgeArtwork,
    forgeAnvilArtwork,
    interfaceFrameArtwork,
    archedFrameArtwork,
    settingsFrameArtwork,
    campfireFrameArtwork,
  ]),
];
