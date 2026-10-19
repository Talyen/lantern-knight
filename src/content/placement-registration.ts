// Native alpha-extents measured against the pinned drawings (including soft edges).
// These are placement measurements, not replacement artwork. A changed manifest
// falls back to its conservative registered trim until measurements are reviewed.
export type PlacementEnvelope = Readonly<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}>;
const envelope = (left: number, right: number, top: number, bottom: number): PlacementEnvelope => ({
  left,
  right,
  top,
  bottom,
});
export const placementRegistration: Readonly<
  Record<
    string,
    {
      readonly hash: string;
      readonly clips: Readonly<Record<string, PlacementEnvelope>>;
    }
  >
> = {
  'library-animation-e3d89a5fb4340376-12e598daecad': {
    hash: '151c9fbc17f1ed7980f33d511308931fbf2f49f683eb10dd4036a2cf82d39640',
    clips: {
      loop: envelope(-1.6563, 1.6719, 2.8868, -0.0352),
      unlit: envelope(-1.6563, 1.6719, 2.3125, -0.0352),
    },
  },
  'library-gb01': {
    hash: 'bc9394212d26a30715483e84796ddd9abd08de763fa6ae3b7fe71514b9a8c86f',
    clips: {
      idle: envelope(-0.7834, 0.7834, 1.6634, 0),
      move: envelope(-0.9, 0.86, 1.7067, 0),
    },
  },
  'library-fp02': {
    hash: '9bec8e544440177e381e36aaf7e8e3a1db46a365602c232a5a33d31b926b6d92',
    clips: {
      idle: envelope(-0.5675, 0.57, 1.1225, 0),
      move: envelope(-0.6075, 0.61, 1.1675, 0),
    },
  },
  'library-zb01': {
    hash: '0c8c9d3ac2c59696a1f24a1be80e72bd0040af0dda5ccd880c692bed1148c5d0',
    clips: {
      idle: envelope(-0.5079, 0.836, 1.7188, -0.2266),
      move: envelope(-0.8047, 0.9141, 1.7735, -0.2266),
    },
  },
  'library-orchard-feral-boar': {
    hash: '5437f2053d68ef7b0a3b304430e1bc7d4aa3841a4f5b2c1d6e102c41a98136ea',
    clips: {
      idle: envelope(-0.5875, 0.675, 1.0625, -0.0125),
      move: envelope(-0.6438, 0.7063, 1.0563, -0.05),
    },
  },
  'library-orchard-rootbound-scarecrow': {
    hash: '6c5ee333cb4dafa4bc7b3428650fa7ca2b76d0e2de4222352bde79482d377873',
    clips: {
      idle: envelope(-0.9264, 0.979, 2.1685, -0.0211),
      move: envelope(-1.1369, 1.0632, 2.1579, -0.1053),
    },
  },
  'library-sk01': {
    hash: '1cd536a1460b207afd9cbc2ffc50bc8be5d16fcbb3121ec465d6c445fbb3cf3d',
    clips: {
      idle: envelope(-0.5, 0.4454, 1.7344, -0.125),
      move: envelope(-0.5704, 0.7188, 1.7969, -0.2227),
    },
  },
  'library-sk02': {
    hash: '5e3fdf31d3cc91f169d21317302be78723a5d275f77b42493b163e5bd05bbe0b',
    clips: {
      idle: envelope(-0.5782, 0.5352, 1.7696, -0.2344),
      move: envelope(-0.7969, 0.7383, 1.8399, -0.2813),
    },
  },
  'fx-brazier-body': {
    hash: '627aeff0a2647e4014d74540affa5122e8e977b8862468445791868288af57b6',
    clips: {
      show: envelope(-0.6614, 0.6728, 0.9887, -0.2069),
    },
  },
  'library-lantern_camp_prop_01_folded_bedroll': {
    hash: 'd40102f8cd202e9e5975b4ec730af4cb80cc44007c33fdd341271cb0728169b1',
    clips: {
      still: envelope(-2.4493, 2.3008, 4.6954, 0.1875),
    },
  },
  'library-lantern_camp_prop_03_kindling_bundle': {
    hash: 'bddfdd8a3d8548a5075813262a9f6779a8dde5aaebcd52e39c6037a638d99be3',
    clips: {
      still: envelope(-2.1016, 2.2774, 4.7071, 0.1328),
    },
  },
  'library-tied_grain_sack': {
    hash: '6adb0b6f9dffaf34356b720402a6dabb235f95a8560b59a1c7d7fe7435164f20',
    clips: {
      closed: envelope(-0.5478, 0.5887, 1.016, -0.2296),
    },
  },
  'library-weathered_satchel': {
    hash: 'ffddcaa22f0d41b8624306a5e9925afa5eeb859cafb2610f8eb07e21a6e8327f',
    clips: {
      closed: envelope(-0.5773, 0.6137, 1.0432, -0.2614),
      open: envelope(-0.5773, 0.6137, 1.4296, -0.2614),
      weathered_satchel_open: envelope(-0.5773, 0.6137, 1.4296, -0.2614),
    },
  },
  'library-prop_wooden_handcart_01': {
    hash: '1cbb4bf00b7ce4ae67ed0e2fe1a4aec0f10ce5d1abc4c791af50d53ba9cb3354',
    clips: {
      still: envelope(-1.7761, 1.751, 2.3773, -0.0427),
    },
  },
  'library-cooper_barrel': {
    hash: 'e1e81c09e7ba516f9513b02230629abbb15333c01fb305e15067b40c963fd0e2',
    clips: {
      closed: envelope(-0.3614, 0.366, 0.9387, -0.066),
    },
  },
  'library-shipping_crate': {
    hash: '29ec23c826af3b86b97a86db95e9bda31be518d9cc911bb789fcc96f8bbca927',
    clips: {
      closed: envelope(-0.6228, 0.6228, 1.0705, -0.3387),
    },
  },
  'library-canvas_rollcase': {
    hash: '71131301feabb05ba472c87f1c1072fe43b6321b4a9a128b6e90f152b3a2a278',
    clips: {
      closed: envelope(-0.7046, 0.6705, 0.9319, -0.25),
      open: envelope(-0.7046, 0.6705, 0.9319, -0.6591),
    },
  },
  'library-mine_wooden_wheelbarrow_01': {
    hash: '3068e1a950c97def568206318f68dd35a480dc63a28fd2e1854bc8bc675f35d9',
    clips: {
      still: envelope(-2.7408, 2.9975, 3.1375, -0.6047),
    },
  },
  'library-furn_workbench_01': {
    hash: '5f6027f0c64c1d5272153f934cdd6cc6ae4aaebb19c1924bf18df8a4d0f22963',
    clips: {
      still: envelope(-1.071, 1.0066, 1.4284, -0.0439),
    },
  },
  'library-masons_tool_chest_opening': {
    hash: '8e44e34ec9eb47e1fc4827d1ea085872bf5ab6acca475a69017208106847bb40',
    clips: {
      idle: envelope(-1.3204, 1.3204, 1.3985, -0.7266),
      open: envelope(-1.3204, 1.4532, 2.3399, -0.7266),
      looted: envelope(-1.3165, 1.4024, 2.3204, -0.7266),
    },
  },
  'library-tripod_brazier': {
    hash: '3e2e603d53da22416c59541f187bc37a4400afbd02fdfdd71b324e3bb5be19fa',
    clips: {
      unlit: envelope(-0.6614, 0.6728, 0.9887, -0.2069),
    },
  },
  'library-animation-e6f2e55954d87141-1e025c65aa2d-slat-native': {
    hash: '6e0d0fbf6d29eb152198aebb59d5e23cf1476d5eab949f94f2c3a6753704e29a',
    clips: {
      break: envelope(-0.41407, 0.33204, 0.72006, -0.08855),
      intact: envelope(-0.29428, 0.28386, 0.65495, -0.08855),
      broken: envelope(-0.36719, 0.33204, 0.56511, -0.08855),
    },
  },
  'library-animation-f3e1b15521d0e58d-ffa5b716b5a5-abandoned-orchard-backpack-native': {
    hash: '3f0cb9fbf8c0c0773bb96a075d0278da60387590c9f0f85f60641fca1e29631a',
    clips: {
      open: envelope(-0.14368, 0.16654, 0.30956, 0),
      closed: envelope(-0.14368, 0.14238, 0.25079, 0),
      opened: envelope(-0.14368, 0.14238, 0.29258, 0),
    },
  },
  'library-animation-e6f2e55954d87141-1e025c65aa2d-barrel-native': {
    hash: 'e0350da9c789dc278e2fb303dbbcb6e33a6456cc4b5f3ce097f853dedb2785d4',
    clips: {
      break: envelope(-0.43099, 0.34375, 0.78646, -0.0612),
      intact: envelope(-0.34636, 0.27214, 0.7474, -0.01172),
      broken: envelope(-0.39844, 0.34245, 0.54558, -0.00391),
    },
  },
  'library-animation-e6f2e55954d87141-1e025c65aa2d-basket-native': {
    hash: 'f245bf0ba79914d61f14eff583beb8956747146a8464a2b8a7650344e885c816',
    clips: {
      open: envelope(-0.4323, 0.3125, 0.87761, -0.01954),
      closed: envelope(-0.32292, 0.28125, 0.71615, -0.00782),
      opened: envelope(-0.42969, 0.3125, 0.87761, -0.00652),
    },
  },
  'library-animation-e6f2e55954d87141-1e025c65aa2d-crate-native': {
    hash: '105a78792b477e39be8facd07722ce07e42a16ab44b8485dc1ee817c53a18462',
    clips: {
      open: envelope(-0.46615, 0.27605, 0.82683, -0.08594),
      closed: envelope(-0.35938, 0.26693, 0.75391, -0.08594),
      opened: envelope(-0.44271, 0.26954, 0.81381, -0.06381),
    },
  },
  'library-animation-7a833570093b0901-f9ce237bd03f-supply_crate-native': {
    hash: 'b13fc2c5f55bc37a0d7ac83d455a246006dbae48cb59bacc29352d8175a09e8e',
    clips: {
      break: envelope(-0.32618, 0.26856, 0.57032, -0.09083),
      intact: envelope(-0.22559, 0.25684, 0.55469, -0.09083),
      broken: envelope(-0.23438, 0.26856, 0.48633, -0.08887),
    },
  },
  'library-animation-7a833570093b0901-f9ce237bd03f-clay_jar-native': {
    hash: '94f62e85a0bfb1c06822f7a925f37ff4818891d97951b36c1afa75d775c2b7a6',
    clips: {
      break: envelope(-0.27735, 0.30176, 0.55762, -0.0918),
      intact: envelope(-0.21778, 0.28516, 0.52344, -0.0918),
      broken: envelope(-0.27735, 0.27247, 0.46192, -0.0879),
    },
  },
  'library-animation-7a833570093b0901-f9ce237bd03f-oval_hamper-native': {
    hash: '0b70884955aa0a9f46f9238742fd008ebc9412acecca5eda4e0f44cf059f579b',
    clips: {
      open: envelope(-0.30372, 0.23438, 0.61524, -0.07129),
      closed: envelope(-0.2754, 0.22461, 0.55567, -0.03516),
      opened: envelope(-0.28028, 0.2295, 0.61329, -0.07129),
    },
  },
  'library-animation-7a833570093b0901-f9ce237bd03f-ochre_chest-native': {
    hash: '1b09cbed08502a8eee6f501774ebe671d33a173bb38205b0b2b4a7b6c797f255',
    clips: {
      open: envelope(-0.32715, 0.21875, 0.59278, -0.08204),
      closed: envelope(-0.31446, 0.20508, 0.49415, -0.07813),
      opened: envelope(-0.31739, 0.20899, 0.57325, -0.08204),
    },
  },
  'library-animation-095cc21b382cf907-aa457a36bc83-charcoal_crate-native': {
    hash: 'bb2e9e6195e985186b4ecb65f7e1de9ff7cfdb0ee6ef6bfe7cb7bdb7894b5ff4',
    clips: {
      break: envelope(-0.26856, 0.29395, 0.56836, -0.0918),
      intact: envelope(-0.26856, 0.25, 0.54688, -0.09083),
      broken: envelope(-0.23731, 0.25, 0.53125, -0.0918),
    },
  },
  'library-animation-01b6ad35f0ea6d5b-ffa5b716b5a5-interact-native': {
    hash: 'cd514729d28908d8b701ebe29eb09065dfbc3e18ef98e81b355542de518de1d6',
    clips: {
      open: envelope(-0.15379, 0.15454, 0.29626, 0.0015),
      closed: envelope(-0.14776, 0.14776, 0.24877, 0.0015),
      opened: envelope(-0.14926, 0.14926, 0.29626, 0.0015),
    },
  },

  'library-animation-8c867dfa177fdfd2-d1edecc41799-offertory_stand-native': {
    hash: '33d2d7acbfa787e3238c85d17349e7a317175c87c9506c886ddd627bf437fd99',
    clips: {
      break: envelope(-0.26758, 0.29297, 0.63672, -0.05958),
      intact: envelope(-0.22657, 0.2793, 0.61329, -0.05958),
      broken: envelope(-0.26758, 0.28028, 0.50684, -0.05567),
    },
  },
  'library-animation-8c867dfa177fdfd2-d1edecc41799-altar_coffer-native': {
    hash: '54cf43e1ac4ccc5ea43ac03054c9e8c70da5242bb4438578b21434ec027d57e7',
    clips: {
      open: envelope(-0.3545, 0.19239, 0.65333, -0.07325),
      closed: envelope(-0.35352, 0.17676, 0.61524, -0.07325),
      opened: envelope(-0.3418, 0.15918, 0.61622, -0.03321),
    },
  },
  'library-animation-037d84d322adba8e-ffa5b716b5a5-a-closed-travel-backpack-native': {
    hash: 'cfe1e297a5bc67c768e661f46b816f98c39606b0621f452055ba0624c3f13f7f',
    clips: {
      open: envelope(-0.11009, 0.13055, 0.22459, 0),
      closed: envelope(-0.0946, 0.13055, 0.22293, 0),
      opened: envelope(-0.10511, 0.12668, 0.22238, 0),
    },
  },
} as const;
