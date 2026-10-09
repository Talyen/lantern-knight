import type { Point } from '../../src/content/world';
import { isSupportedPosition, supportedPosition } from '../../src/content/world';
import { sandboxContent } from '../../src/content/sandbox-world';
import { worldVisuals } from '../../src/content/game-content';

// Optional scene journeys follow current authored data, not a frozen composition.
export function sceneFixture(scene: string, entry: Point) {
  const area = sandboxContent.area(scene),
    art = worldVisuals[scene];
  const route = art?.paths[0]?.points.filter((p) => isSupportedPosition(area, p, 0.3)) ?? [];
  const exit = area.exits[0]?.trigger;
  if (!route.length && exit)
    route.push(
      supportedPosition(
        area,
        { x: (exit.minX + exit.maxX) / 2, z: (exit.minZ + exit.maxZ) / 2 },
        0.3,
      ),
    );
  const front = art?.props.find((p) => p.fade);
  return {
    route: [entry, ...route],
    foreground: front ? supportedPosition(area, { x: front.x, z: front.z - 0.2 }, 0.3) : entry,
  };
}
