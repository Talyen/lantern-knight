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
} as const;
