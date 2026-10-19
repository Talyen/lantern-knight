import type { ActorSprite } from './sprite';

// Screen-plane world units: center X/Y and radii. These are visual support
// marks, independent of collision and the actor's registered simulation root.
export type ContactPatch = readonly [number, number, number, number];
export type ContactPatches = readonly [ContactPatch, ContactPatch];

function soles(
  registration: readonly [number, number, number],
  a: ContactPatch,
  b: ContactPatch,
): ContactPatches {
  const [x, y, density] = registration;
  const point = ([px, py, rx, ry]: ContactPatch): ContactPatch => [
    (px - x) / density,
    (y - py) / density,
    rx / density,
    ry / density,
  ];
  return [point(a), point(b)];
}

// Reviewed against each native idle drawing's soles. Keep one stable stance
// across its small idle redraws; alpha bounds also include the sword/lantern.
const heroIdle: Readonly<Record<string, ContactPatches>> = {
  'idle-d00-00': soles([294.9051, 497.7153, 316.9929], [242, 485, 42, 13], [369, 535, 39, 13]),
  'idle-d45-00': soles([384, 640, 296.9415], [329, 677, 35, 12], [453, 686, 35, 12]),
  'idle-d90-00': soles([201.0465, 483.6259, 301.2855], [196, 519, 40, 13], [259, 443, 36, 12]),
  'idle-d135-00': soles([384, 640, 298.8032], [378, 674, 34, 11], [417, 638, 31, 11]),
  'idle-d180-00': soles([230.5684, 476.3254, 291.7699], [183, 457, 33, 12], [290, 501, 35, 12]),
  'idle-d225-00': soles([384, 640, 297.2518], [316, 673, 28, 11], [440, 682, 32, 11]),
  'idle-d270-00': soles([269.1589, 476.2738, 290.985], [244, 513, 41, 12], [316, 468, 32, 11]),
  'idle-d315-00': soles([384, 640, 301.906], [350, 637, 33, 11], [404, 676, 38, 12]),
};
const skeletonIdle = soles([320, 520, 256], [239, 542, 37, 12], [390, 493, 43, 12]);

export function actorContactPatches(sprite: ActorSprite): ContactPatches | undefined {
  const first = sprite.animator.clip.frames[0]!;
  if (
    sprite.manifest.asset.id === 'ink-hero-current' &&
    sprite.manifest.hash === '03ac4b4fbb1459f85a56b3bb9c48af73d5b2144ba0e302513088e3cab151889a'
  )
    return Object.hasOwn(heroIdle, first) ? heroIdle[first] : undefined;
  if (
    sprite.manifest.asset.id === 'library-sk01' &&
    sprite.manifest.hash === '1cd536a1460b207afd9cbc2ffc50bc8be5d16fcbb3121ec465d6c445fbb3cf3d' &&
    first === 'frame-2391b49a5d6fd8b5dbc80207'
  )
    return skeletonIdle;
}

// The toolbox's base is a parallelogram in the drawing. Project its two axes
// onto the receiving floor; opening the lid must not resize or move the base.
export function toolboxContact(sprite: ActorSprite) {
  if (
    sprite.manifest.asset.id ===
      'library-animation-01b6ad35f0ea6d5b-ffa5b716b5a5-interact-native' &&
    sprite.manifest.hash === 'cd514729d28908d8b701ebe29eb09065dfbc3e18ef98e81b355542de518de1d6'
  )
    return {
      center: [0, 87 / 1326.5454545454545] as const,
      x: [286 / 1326.5454545454545, 98 / 1326.5454545454545] as const,
      y: [-112 / 1326.5454545454545, 72 / 1326.5454545454545] as const,
    };
}
