import { parseSceneDocument } from './scene-document';
import { resolveScene } from './world-art';

// Small presentation fixtures, never authored adventure content. Game does not import them.
const bounds = { minX: -7, maxX: 7, minZ: -8, maxZ: 8 };
function fixture(interior: boolean) {
  const id = interior ? 'interior-fixture' : 'outdoor-fixture';
  return resolveScene(
    parseSceneDocument({
      version: 5,
      id,
      base: id,
      target: 'draft',
      profile: 'study',
      name: interior ? 'Interior fixture' : 'Outdoor fixture',
      floor: { asset: interior ? 'ink-stage-stone' : 'ink-stage-earth', width: 14, depth: 16 },
      geometry: {
        bounds,
        surface: { kind: 'flat', height: 0 },
        baselineEntry: 'start',
        activation: { minX: -7, maxX: 7, minZ: -8, maxZ: 2 },
        entries: [{ id: 'start', x: 0, z: 5 }],
      },
      hero: { x: 0, z: 5 },
      look: { rig: 'golden', look: 'diorama' },
      camera: {
        bounds: { minX: -2, maxX: 2, minZ: -6, maxZ: 6 },
        bias: { x: 0, z: -1.5 },
        keepHeroVisible: true,
        ...(interior
          ? { arrival: { start: 3, end: 7.5, biasZ: -7, span: 11, targetHeight: 2.2 } }
          : {}),
      },
      ...(interior ? { interior: bounds } : {}),
      surround: {
        anchor: { x: 0, z: 0 },
        color: 0x344b4e,
        ground: [
          { x: -12, z: -13 },
          { x: 12, z: -13 },
          { x: 12, z: 13 },
          { x: -12, z: 13 },
        ],
        layers: [
          {
            asset: 'ink-tended-woodland-far',
            clip: 'woodland-far',
            scale: 1.7,
            base: -2,
            parallax: 0.65,
            tint: 0x607279,
            detail: 0.06,
          },
        ],
      },
      paths: [
        {
          points: [
            { x: 0, z: 5 },
            { x: 0, z: -4 },
          ],
          width: 2,
        },
      ],
      objects: interior
        ? [
            { id: 'support', kind: 'prop', asset: 'ink-chapel-altar', clip: 'altar', x: -3, z: -3 },
            {
              id: 'lamp',
              kind: 'prop',
              asset: 'ink-crypt',
              clip: 'votive-hardware',
              role: 'attachment',
              mount: { to: 'support', socket: 'votive', offset: [-0.07, 1.15, 0.08] },
              fixture: {
                id: 'lamp-light',
                socket: [0, 0.38, 0],
                power: 0.85,
                range: 3.4,
                phase: 0.31,
                smoke: false,
                embersScale: 0.28,
              },
            },
          ]
        : [
            {
              id: 'foreground',
              kind: 'prop',
              asset: 'ink-blackwood-oak',
              clip: 'oak',
              x: -4,
              z: -2,
              fade: true,
            },
            {
              id: 'lamp',
              kind: 'prop',
              asset: 'ink-graveyard-scenery',
              clip: 'crook-lamp',
              x: 3,
              z: -2,
              fixture: {
                id: 'lamp-light',
                socket: [0.3, 2.0875, -0.3],
                power: 0.8,
                range: 3,
                phase: 0.2,
                smoke: true,
                embersScale: 0.28,
                flame: {
                  asset: 'ink-ambient',
                  clip: 'lamp_flame',
                  offset: [0.3, 2.0875, -0.3],
                  scale: 0.38,
                  phase: 0.2,
                  depthOffset: 0.008,
                  decorative: true,
                },
              },
            },
          ],
      proceduralAssets: ['ink-stage-earth'],
      gameplay: {
        spawns: [{ id: 'target', actor: 'skeleton', x: 1, z: 0 }],
        exits: [],
        pickups: [],
      },
    }),
  );
}
export const developerScenes = [fixture(false), fixture(true)];
export const developerVisuals = Object.fromEntries(
  developerScenes.map((s) => [s.area.id, s.visuals]),
);
