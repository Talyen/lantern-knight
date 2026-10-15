// Native alpha-extents measured against the pinned drawings (including soft edges).
// These are placement measurements, not replacement artwork. A changed manifest
// falls back to its conservative registered trim until measurements are reviewed.
export const placementRegistration = {
  'library-sk01': {
    hash: '1cd536a1460b207afd9cbc2ffc50bc8be5d16fcbb3121ec465d6c445fbb3cf3d',
    clips: {
      idle: {
        left: -0.5,
        right: 0.4454,
        top: 1.7344,
        bottom: -0.125,
      },
      move: {
        left: -0.5704,
        right: 0.7188,
        top: 1.7969,
        bottom: -0.2227,
      },
    },
  },
  'fx-brazier-body': {
    hash: '627aeff0a2647e4014d74540affa5122e8e977b8862468445791868288af57b6',
    clips: {
      show: {
        left: -0.6614,
        right: 0.6728,
        top: 0.9887,
        bottom: -0.2069,
      },
    },
  },
  'library-lantern_camp_prop_01_folded_bedroll': {
    hash: 'd40102f8cd202e9e5975b4ec730af4cb80cc44007c33fdd341271cb0728169b1',
    clips: {
      still: {
        left: -2.4493,
        right: 2.3008,
        top: 4.6954,
        bottom: 0.1875,
      },
    },
  },
  'library-lantern_camp_prop_03_kindling_bundle': {
    hash: 'bddfdd8a3d8548a5075813262a9f6779a8dde5aaebcd52e39c6037a638d99be3',
    clips: {
      still: {
        left: -2.1016,
        right: 2.2774,
        top: 4.7071,
        bottom: 0.1328,
      },
    },
  },
  'library-tied_grain_sack': {
    hash: '6adb0b6f9dffaf34356b720402a6dabb235f95a8560b59a1c7d7fe7435164f20',
    clips: {
      closed: {
        left: -0.5478,
        right: 0.5887,
        top: 1.016,
        bottom: -0.2296,
      },
    },
  },
  'library-weathered_satchel': {
    hash: 'ffddcaa22f0d41b8624306a5e9925afa5eeb859cafb2610f8eb07e21a6e8327f',
    clips: {
      closed: {
        left: -0.5773,
        right: 0.6137,
        top: 1.0432,
        bottom: -0.2614,
      },
      open: {
        left: -0.5773,
        right: 0.6137,
        top: 1.4296,
        bottom: -0.2614,
      },
    },
  },
  'library-prop_wooden_handcart_01': {
    hash: '1cbb4bf00b7ce4ae67ed0e2fe1a4aec0f10ce5d1abc4c791af50d53ba9cb3354',
    clips: {
      still: {
        left: -1.7761,
        right: 1.751,
        top: 2.3773,
        bottom: -0.0427,
      },
    },
  },
  'library-cooper_barrel': {
    hash: 'e1e81c09e7ba516f9513b02230629abbb15333c01fb305e15067b40c963fd0e2',
    clips: {
      closed: {
        left: -0.3614,
        right: 0.366,
        top: 0.9387,
        bottom: -0.066,
      },
    },
  },
  'library-shipping_crate': {
    hash: '29ec23c826af3b86b97a86db95e9bda31be518d9cc911bb789fcc96f8bbca927',
    clips: {
      closed: {
        left: -0.6228,
        right: 0.6228,
        top: 1.0705,
        bottom: -0.3387,
      },
    },
  },
  'library-canvas_rollcase': {
    hash: '71131301feabb05ba472c87f1c1072fe43b6321b4a9a128b6e90f152b3a2a278',
    clips: {
      closed: {
        left: -0.7046,
        right: 0.6705,
        top: 0.9319,
        bottom: -0.25,
      },
      open: {
        left: -0.7046,
        right: 0.6705,
        top: 0.9319,
        bottom: -0.6591,
      },
    },
  },
  'library-mine_wooden_wheelbarrow_01': {
    hash: '3068e1a950c97def568206318f68dd35a480dc63a28fd2e1854bc8bc675f35d9',
    clips: {
      still: {
        left: -2.7408,
        right: 2.9975,
        top: 3.1375,
        bottom: -0.6047,
      },
    },
  },
  'library-furn_workbench_01': {
    hash: '5f6027f0c64c1d5272153f934cdd6cc6ae4aaebb19c1924bf18df8a4d0f22963',
    clips: {
      still: {
        left: -1.071,
        right: 1.0066,
        top: 1.4284,
        bottom: -0.0439,
      },
    },
  },
  'library-masons_tool_chest_opening': {
    hash: '8e44e34ec9eb47e1fc4827d1ea085872bf5ab6acca475a69017208106847bb40',
    clips: {
      idle: {
        left: -1.3204,
        right: 1.3204,
        top: 1.3985,
        bottom: -0.7266,
      },
      open: {
        left: -1.3204,
        right: 1.4532,
        top: 2.3399,
        bottom: -0.7266,
      },
      looted: {
        left: -1.3165,
        right: 1.4024,
        top: 2.3204,
        bottom: -0.7266,
      },
    },
  },
  'library-tripod_brazier': {
    hash: '3e2e603d53da22416c59541f187bc37a4400afbd02fdfdd71b324e3bb5be19fa',
    clips: {
      unlit: {
        left: -0.6614,
        right: 0.6728,
        top: 0.9887,
        bottom: -0.2069,
      },
    },
  },
} as const;
