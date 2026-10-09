import type { Point } from './world';
import type { BurialPlot } from './world-art';
export function graveHead(g: BurialPlot): Point {
  const a = g.angle ?? 0;
  return {
    x: g.x + Math.sin(a) * (g.length / 2 + 0.06),
    z: g.z - Math.cos(a) * (g.length / 2 + 0.06),
  };
}
