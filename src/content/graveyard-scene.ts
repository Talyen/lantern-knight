import type { Point } from './world';
import type { BurialPlot, WorldVisualDefinition } from './world-art';
export function graveHead(g: BurialPlot): Point {
  const a = g.angle ?? 0;
  return {
    x: g.x + Math.sin(a) * (g.length / 2 + 0.06),
    z: g.z - Math.cos(a) * (g.length / 2 + 0.06),
  };
}
export const graveyardFoundation: WorldVisualDefinition = {
  surround: {
    anchor: {
      x: 0,
      z: 0,
    },
    color: 3427150,
    ground: [
      {
        x: -10,
        z: -8,
      },
      {
        x: -5,
        z: -11,
      },
      {
        x: 5,
        z: -11,
      },
      {
        x: 10,
        z: -8,
      },
      {
        x: 11,
        z: 1,
      },
      {
        x: 9.5,
        z: 9,
      },
      {
        x: 2,
        z: 13,
      },
      {
        x: -5,
        z: 12,
      },
      {
        x: -10,
        z: 8,
      },
      {
        x: -11,
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
  floor: 'ink-stage-earth',
  props: [],
  walls: [],
  paths: [
    {
      width: 1.6,
      points: [
        { x: 0, z: 8.5 },
        { x: 0, z: 6.65 },
        { x: 0, z: 2.25 },
        { x: 0, z: -2.8 },
        { x: 0, z: -5.5 },
      ],
    },
  ],
  graves: [],
  patches: [],
  lights: [],
  decals: [],
  proceduralAssets: ['ink-cues', 'ink-stage-earth', 'ink-ambient'],
  camera: {
    keepHeroVisible: true,
    bounds: {
      minX: -1.6,
      maxX: 2,
      minZ: -5.8,
      maxZ: 2.4,
    },
    bias: {
      x: 0.65,
      z: -2.8,
    },
    targetHeight: 0.6,
    arrival: {
      start: 2.2,
      end: 6.65,
      biasZ: -4.9,
      targetHeight: 0.6,
    },
  },
  assemblies: [],
  overlaps: [],
  propOrder: [],
};
