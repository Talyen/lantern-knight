import type { Point } from '../../src/content/world';

export function sceneFixture(scene: string, entry: Point) {
  const fixtures: Record<string, { route: Point[]; foreground: Point }> = {
    court: {
      route: [
        entry,
        { x: 0, z: 4.7 },
        { x: 0, z: 2.25 },
        { x: 0.6, z: -0.3 },
        { x: 0.45, z: -2.8 },
        { x: 0, z: -5.4 },
      ],
      foreground: { x: -3.3, z: 7.25 },
    },
    'upper-landing': {
      route: [entry, { x: 0, z: 3 }, { x: 0, z: -3 }, { x: 0, z: -5.5 }],
      foreground: { x: 3.4, z: 1.6 },
    },
  };
  return fixtures[scene] ?? { route: [entry, { x: 0, z: 0 }], foreground: entry };
}
