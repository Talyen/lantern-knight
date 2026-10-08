import type { Point } from './world';
import type { ArtPlacement, BurialPlot, SiteWall, WorldVisualDefinition } from './world-art';
import { retainingStones, terraceHeight, gatewayLayout, chapelLayout } from './graveyard-layout';
const stone = 0xc2c7b7;
export const graveRows: BurialPlot[] = [
  {
    id: 'family-kept',
    x: -4.25,
    z: 1.25,
    width: 0.8,
    length: 1.7,
    age: 'old',
    angle: -0.13,
  },
  {
    id: 'family-plaque',
    x: -5.35,
    z: -0.15,
    width: 0.7,
    length: 1.5,
    age: 'old',
    angle: 0.16,
    marker: 'memorial',
  },
  {
    id: 'family-old',
    x: -4.3,
    z: -0.45,
    width: 0.82,
    length: 1.65,
    age: 'old',
    angle: -0.22,
  },
  {
    id: 'east-old-1',
    x: 3.9,
    z: 2.25,
    width: 0.8,
    length: 1.75,
    age: 'old',
    angle: 0.3,
  },
  {
    id: 'east-old-2',
    x: 5.3,
    z: 0.85,
    width: 0.8,
    length: 1.6,
    age: 'old',
    angle: 0.13,
    marker: 'memorial',
  },
  {
    id: 'east-old-3',
    x: 4.65,
    z: -1.15,
    width: 0.82,
    length: 1.65,
    age: 'old',
    angle: -0.2,
  },
  {
    id: 'disturbed',
    x: -3.9,
    z: -3.45,
    width: 0.9,
    length: 1.7,
    age: 'damaged',
    angle: -0.2,
    marker: 'fallen-marker',
  },
  {
    id: 'recent',
    x: 3.75,
    z: -3.55,
    width: 0.8,
    length: 1.7,
    age: 'kept',
    angle: 0.05,
  },
];
export function graveHead(g: BurialPlot): Point {
  const a = g.angle ?? 0;
  return {
    x: g.x + Math.sin(a) * (g.length / 2 + 0.06),
    z: g.z - Math.cos(a) * (g.length / 2 + 0.06),
  };
}
const props: ArtPlacement[] = [
  ...graveRows.map((g) => {
    const rooted = g.id === 'family-plaque',
      fallen = g.id === 'disturbed',
      native = ['family-kept', 'east-old-1'].includes(g.id);
    return {
      id: `grave-${g.id}`,
      clip: rooted
        ? 'roots'
        : fallen
          ? 'fragments'
          : native
            ? 'marker'
            : g.id === 'recent'
              ? 'memorial'
              : (g.marker ?? 'gravestone'),
      asset: rooted
        ? 'ink-tended-roots'
        : fallen
          ? 'ink-tended-fragments'
          : native
            ? 'ink-tended-marker'
            : 'ink-scenery',
      ...graveHead(g),
      y: terraceHeight(g.x, g.z) - (g.id === 'east-old-3' ? 0.12 : 0),
      scale:
        rooted || fallen || g.id === 'recent'
          ? 1
          : native
            ? 0.9
            : g.marker === 'memorial'
              ? 0.8
              : 0.9,
      tint: stone,
      footprint: (fallen ? [1.15, 0.75] : [0.55, 0.3]) as readonly [number, number],
      footprintAngle: g.angle ?? 0,
      assembly: `burial-${g.id}`,
      purpose: rooted
        ? 'Oak roots displacing a half-buried family memorial'
        : `Settled ${g.age} burial within its authored group`,
    };
  }),
  {
    asset: 'ink-scenery',
    id: 'family-tomb-west',
    clip: 'tomb',
    x: -5.95,
    z: 1.05,
    y: 0.3,
    tint: stone,
    footprint: [0.85, 2.1],
    purpose: 'One settled family tomb sheltered beneath the ancient oak',
  },
  {
    id: 'boundary-oak',
    clip: 'oak',
    asset: 'ink-blackwood-oak',
    x: -6.9,
    z: -1.65,
    y: 0.3,
    scale: 1.05,
    fade: true,
    tint: 0xa8bdb5,
    purpose: 'Ancient oak anchoring the western family burials',
  },
  {
    asset: 'ink-scenery',
    id: 'gate-lamp',
    clip: 'crook-lamp',
    x: -4.25,
    z: 7.1,
    scale: 0.8,
    footprint: [0.2, 0.2],
    purpose: 'Last maintained lamp beneath the broken approach gateway',
  },
  {
    asset: 'ink-scenery',
    id: 'threshold-light',
    clip: 'lantern-hardware',
    x: -1.45,
    z: -5.35,
    purpose: 'Tended lantern marking the chapel threshold',
  },
  {
    asset: 'ink-scenery',
    id: 'chapel-cresset',
    clip: 'cresset-hardware',
    x: -1.2,
    z: -6.0,
    y: 1.7,
    purpose: 'Strongest environmental light beside the recessed chapel door',
  },
  {
    asset: 'ink-scenery',
    id: 'recent-offering',
    clip: 'offering-table',
    x: 3.05,
    z: -4.5,
    scale: 0.38,
    tint: 0xd7d1b7,
    footprint: [0.42, 0.32],
    purpose: 'Small cleared stone shelf beside the recent burial',
  },
  ...[
    [-6.1, 2.5, 0.85],
    [-6.5, -0.65, 0.8],
    [5.8, 1.7, 0.72],
    [5.85, -1.6, 0.65],
    [4.65, -2.9, 0.6],
  ].map(([x, z, scale], i) => ({
    id: `understory-mass-${i}`,
    clip: 'understory',
    asset: 'ink-tended-understory',
    x: x!,
    z: z!,
    y: terraceHeight(x!, z!),
    scale: scale!,
    tint: 0x789b8e,
    purpose: 'Connected sheltered planting around burial groups',
  })),
  ...[
    [-5.7, 1.7, 0.8],
    [-5.55, -1.0, 1.05],
    [4.5, 2.6, 1.3],
    [5.1, -1.6, 1.1],
  ].map(([x, z, scale], i) => ({
    asset: 'ink-scenery',
    id: `fern-bank-${i}`,
    clip: 'fern',
    x: x!,
    z: z!,
    y: terraceHeight(x!, z!),
    scale: scale!,
    tint: 0x9fb6a1,
    purpose: 'Fern silhouettes clustered at root and stone joins',
  })),
  ...[
    [-3.4, 1.75],
    [-6.35, -2.45],
    [5.8, 0.0],
  ].map(([x, z], i) => ({
    asset: 'ink-scenery',
    id: `rim-overgrowth-${i}`,
    clip: 'bramble',
    x: x!,
    z: z!,
    y: terraceHeight(x!, z!),
    scale: 0.6,
    tint: 0x728d81,
    purpose: 'Sparse overgrowth joining broken masonry to woodland',
  })),
  ...[
    [-8.9, 3, 0.95],
    [-8.3, -5.8, 1.0],
    [-5.8, -8.8, 0.85],
    [2, -9.6, 0.9],
    [8, -7.8, 0.9],
    [8.8, -3.2, 1.05],
    [9, 4.7, 0.95],
    [-7.6, 8.5, 0.8],
    [7, 9.5, 0.85],
  ].map(([x, z, scale], i) => ({
    id: `woodland-${i}`,
    clip: i % 3 === 0 ? 'woodland' : 'woodland-near',
    asset: i % 3 === 0 ? 'ink-blackwood-woodland' : 'ink-tended-woodland-near',
    x: x!,
    z: z!,
    scale: scale!,
    mirror: i % 2 === 1,
    fade: z! > 4 || x! > 6,
    tint: 0x73968f,
    purpose: 'Connected blue-green woodland with openings toward the chapel',
  })),
  {
    id: 'foreground-oak',
    clip: 'oak',
    asset: 'ink-blackwood-oak',
    x: 8.8,
    z: 9.2,
    scale: 0.95,
    mirror: true,
    fade: true,
    tint: 0x4d6a63,
    purpose: 'Charcoal foreground crown framing the clearing without closing the path',
  },
];
const c = chapelLayout,
  g = gatewayLayout;
const walls: SiteWall[] = [
  ...retainingStones,
  {
    id: 'chapel-front-left',
    from: { x: -c.width / 2, z: c.frontZ },
    to: { x: -0.85, z: c.frontZ },
    height: c.wallHeight,
    thickness: 0.35,
    surface: 'masonry',
    assembly: 'chapel',
  },
  {
    id: 'chapel-front-right',
    from: { x: 0.85, z: c.frontZ },
    to: { x: c.width / 2, z: c.frontZ },
    height: c.wallHeight,
    thickness: 0.35,
    surface: 'masonry',
    assembly: 'chapel',
  },
  {
    id: 'gateway-west-pier',
    from: { x: g.x - g.halfGap - g.pierWidth / 2, z: g.z },
    to: { x: g.x - g.halfGap + g.pierWidth / 2, z: g.z },
    height: g.leftHeight,
    thickness: g.pierDepth,
    surface: 'masonry',
    assembly: 'gateway',
  },
  {
    id: 'gateway-east-pier',
    from: { x: g.x + g.halfGap - g.pierWidth / 2, z: g.z },
    to: { x: g.x + g.halfGap + g.pierWidth / 2, z: g.z },
    height: g.rightHeight,
    thickness: g.pierDepth,
    surface: 'masonry',
    assembly: 'gateway',
  },
];
const fixtures = [
  {
    id: 'entrance-flame',
    prop: 'gate-lamp',
    socket: [0.24, 1.67, -0.24] as const,
    power: 0.45,
    radius: 2.4,
    phase: 0.2,
    flameScale: 0.3,
  },
  {
    id: 'porch-flame',
    prop: 'threshold-light',
    socket: [-0.03, 0.22, 0.03] as const,
    power: 0.8,
    radius: 3,
    phase: 0.7,
    flameScale: 0.25,
  },
  {
    id: 'cresset-flame',
    prop: 'chapel-cresset',
    socket: [-0.11, 0.32, 0.11] as const,
    power: 1.65,
    radius: 4.1,
    phase: 0.45,
    smoke: true,
    flameScale: 0.6,
  },
];
export const graveyardScene: WorldVisualDefinition = {
  surround: {
    anchor: { x: 0, z: 0 },
    color: 0x344b4e,
    ground: [
      { x: -10, z: -8 },
      { x: -5, z: -11 },
      { x: 5, z: -11 },
      { x: 10, z: -8 },
      { x: 11, z: 1 },
      { x: 9.5, z: 9 },
      { x: 2, z: 13 },
      { x: -5, z: 12 },
      { x: -10, z: 8 },
      { x: -11, z: 0 },
    ],
    layers: [
      {
        asset: 'ink-tended-woodland-far',
        clip: 'woodland-far',
        scale: 1.7,
        base: -2,
        parallax: 0.65,
        tint: 0x607379,
        detail: 0.06,
      },
      {
        asset: 'ink-tended-woodland-far',
        clip: 'woodland-far',
        scale: 2.0,
        base: -4,
        parallax: 0.85,
        tint: 0x3e5550,
        detail: 0.15,
      },
    ],
  },
  floor: 'ink-graveyard-materials',
  props: props.map((p) => {
    const f = fixtures.find((f) => f.prop === p.id);
    return {
      ...p,
      shadow: 'none' as const,
      ...([
        'juniper',
        'fallen-marker',
        'crook-lamp',
        'lantern-hardware',
        'cresset-hardware',
      ].includes(p.clip)
        ? { asset: 'ink-graveyard-scenery' }
        : {}),
      ...(f
        ? {
            light: {
              offset: f.socket.map((v) => v / (p.scale ?? 1)) as [number, number, number],
              power: f.power,
              range: f.radius,
              phase: f.phase,
            },
          }
        : {}),
    };
  }),
  walls,
  fixtures,
  paths: [
    {
      width: 1.45,
      widths: [1.4, 1.5, 1.65, 2.3, 2.5, 1.8],
      points: [
        { x: -3.3, z: 40 },
        { x: -3.3, z: 7.4 },
        { x: -2.5, z: 4.6 },
        { x: -0.2, z: 2.2 },
        { x: 0.2, z: -1.5 },
        { x: 0, z: -5.8 },
      ],
    },
  ],
  graves: graveRows,
  patches: [],
  lights: [],
  decals: [
    {
      asset: 'ink-decals',
      id: 'tree-leaves',
      clip: 'd05_leaf_drift',
      x: -5.05,
      z: 1.65,
      scale: 0.5,
    },
    {
      asset: 'ink-ground-transitions',
      id: 'old-roots',
      clip: 't08_crossing_root',
      x: -5.8,
      z: -0.75,
      scale: 0.55,
      rotation: 0.6,
    },
    {
      asset: 'ink-decals',
      id: 'porch-scuffs',
      clip: 'd08_dirt_scuffs',
      x: 0,
      z: -5.0,
      scale: 0.3,
    },
    {
      asset: 'ink-decals',
      id: 'gate-scuffs',
      clip: 'd08_dirt_scuffs',
      x: -3.3,
      z: 7.4,
      scale: 0.25,
    },
    {
      asset: 'ink-ground-transitions',
      id: 'family-damp',
      clip: 't07_damp_spread',
      x: 5.0,
      z: -1.2,
      scale: 0.6,
    },
    {
      asset: 'ink-ground-transitions',
      id: 'east-puddle',
      clip: 't06_still_puddle',
      x: 3.25,
      z: 3.1,
      scale: 0.25,
    },
    {
      asset: 'ink-decals',
      id: 'west-leaf-bank',
      clip: 'd06_scattered_leaves',
      x: -5.2,
      z: 2.35,
      scale: 0.5,
    },
    {
      asset: 'ink-decals',
      id: 'family-moss',
      clip: 'd03_moss_edge',
      x: 5.5,
      z: 0.8,
      scale: 0.6,
    },
    {
      asset: 'ink-decals',
      id: 'old-grave-moss',
      clip: 'd04_moss_islands',
      x: -4.2,
      z: -1.0,
      scale: 0.55,
    },
  ].map((p) => ({
    ...p,
    asset: 'ink-graveyard-overlays',
    purpose: 'Authored ground overlay',
  })),
  proceduralAssets: [
    'ink-ambient',
    'ink-moss',
    'ink-masonry',
    'ink-soil',
    'ink-chapel-front',
    'ink-churchyard-roof',
    'ink-cues',
  ],
  camera: {
    keepHeroVisible: true,
    bounds: { minX: -1.6, maxX: 2.0, minZ: -5.8, maxZ: 2.4 },
    bias: { x: 0.65, z: -2.8 },
    targetHeight: 2.6,
    arrival: { start: 2.2, end: 6.65, biasZ: -4.9, targetHeight: 0.55 },
  },
  assemblies: [],
  overlaps: [],
};
