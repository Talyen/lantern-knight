import type { WorldVisualDefinition } from './world-art';
export const cryptFoundation: WorldVisualDefinition = {
  surround: {
    anchor: {
      x: 0,
      z: 0,
    },
    color: 3427150,
    ground: [
      {
        x: -9,
        z: -8,
      },
      {
        x: -6,
        z: -12,
      },
      {
        x: 5,
        z: -12,
      },
      {
        x: 9,
        z: -8,
      },
      {
        x: 10,
        z: 1,
      },
      {
        x: 9,
        z: 9,
      },
      {
        x: 3,
        z: 13,
      },
      {
        x: -5,
        z: 12,
      },
      {
        x: -9,
        z: 8,
      },
      {
        x: -10,
        z: 0,
      },
    ],
    layers: [
      {
        asset: 'ink-tended-woodland-far',
        clip: 'woodland-far',
        scale: 1.7,
        base: -2,
        parallax: 0.65,
        tint: 6321017,
        detail: 0.06,
      },
      {
        asset: 'ink-tended-woodland-far',
        clip: 'woodland-far',
        scale: 2,
        base: -4,
        parallax: 0.85,
        tint: 4085072,
        detail: 0.15,
      },
    ],
  },
  floor: 'ink-stage-stone',
  interior: {
    minX: -6,
    maxX: 6,
    minZ: -9,
    maxZ: 9,
  },
  props: [
    {
      id: 'crypt-return-door',
      asset: 'ink-crypt',
      clip: 'doorway',
      x: 0,
      z: 9,
      zone: 'entry',
      door: true,
      fade: true,
      shadow: 'none',
      purpose: 'Intact illustrated return portal at the safe threshold',
    },
  ],
  walls: [],

  paths: [],
  graves: [],

  proceduralAssets: [
    'ink-cues',
    'ink-stage-earth',
    'ink-ambient',
    'ink-crypt-ambient',
    'ink-crypt-feature',
  ],
  decals: [],
  camera: {
    bounds: {
      minX: -2,
      maxX: 2,
      minZ: -6,
      maxZ: 5.9,
    },
    bias: {
      x: 0,
      z: -1.5,
    },
    targetHeight: 0.6,
    arrival: {
      start: 3,
      end: 7.5,
      biasZ: -7,
      span: 11,
      targetHeight: 2.2,
    },
  },
  propOrder: [],
  overlaps: [],
};
