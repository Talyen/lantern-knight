import { Vector3, type OrthographicCamera } from 'three';
import { clearSegment } from '../content/collision';
import { tuning } from '../content/gameplay';
import { actorVisuals } from '../content/visuals';
import type { AreaDefinition, Point } from '../content/world';
import type { ActorView } from '../core/simulation-view';

// Resolve a cursor on an upright enemy to its feet. Floor projection alone can
// point behind the hero when the cursor is on a nearby enemy's head or torso.
// This small body capsule excludes weapons and does not extend combat reach.
export function enemyAimPoint(
  camera: OrthographicCamera,
  pointer: { x: number; y: number },
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  hero: Point & { y?: number },
  enemies: readonly ActorView[],
  area: AreaDefinition,
): Point | undefined {
  if (rect.width <= 0 || rect.height <= 0) return;
  const project = (x: number, y: number, z: number) => {
    const p = new Vector3(x, y, z).project(camera);
    return {
      x: rect.left + ((p.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - p.y) * rect.height) / 2,
      depth: p.z,
    };
  };
  const pixelsPerUnit = (rect.height * camera.zoom) / (camera.top - camera.bottom);
  let selected: ActorView | undefined,
    depth = Infinity;
  for (const enemy of enemies) {
    if (
      enemy.health <= 0 ||
      Math.abs(enemy.y - (hero.y ?? 0)) > tuning.maxCombatHeightDifference ||
      !clearSegment(area, hero, enemy, 0.001)
    )
      continue;
    const scale = actorVisuals[enemy.definition.visual]?.scale ?? 1,
      bottom = project(enemy.x, enemy.y + 0.35 * scale, enemy.z),
      top = project(enemy.x, enemy.y + 1.55 * scale, enemy.z),
      radius = Math.max(0.3 * scale, enemy.definition.radius * 1.4) * pixelsPerUnit,
      y = Math.max(top.y, Math.min(bottom.y, pointer.y));
    if (Math.hypot(pointer.x - bottom.x, pointer.y - y) <= radius && bottom.depth < depth) {
      selected = enemy;
      depth = bottom.depth;
    }
  }
  return selected && { x: selected.x, z: selected.z };
}
