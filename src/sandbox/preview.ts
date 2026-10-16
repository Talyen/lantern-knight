import { z } from 'zod';
import {
  supportedPosition,
  isSupportedPosition,
  heightAt,
  type ContentRegistry,
} from '../content/world';
import { effectiveRadius } from '../content/collision';
const finite = z.number().finite();
export const scenePreviewSchema = z.object({
  version: z.literal(1),
  scene: z.string(),
  hero: z.object({ x: finite, z: finite, yaw: finite }),
  span: finite.min(1).max(100),
  scale: z.union([z.literal(1), z.literal(0.75), z.literal(0.5)]),
  paused: z.boolean(),
  mode: z.enum(['encounter', 'calibration', 'animation', 'occlusion', 'lighting']),
  look: z.object({
    rig: z.enum(['golden', 'silver', 'lantern']),
    look: z.enum(['ink', 'diorama', 'cinematic']),
    baseline: z.boolean(),
    lighting: z.boolean(),
    shadows: z.boolean(),
    atmosphere: z.boolean(),
    postprocessing: z.boolean(),
    paintedValues: z.boolean().default(false),
    groundBounce: z.boolean().default(false),
    tightContacts: z.boolean().default(false),
    strength: finite.min(0).max(2),
    depthOfField: finite.min(0).max(1),
  }),
});
type ScenePreviewState = z.infer<typeof scenePreviewSchema>;
export function previewHero(state: ScenePreviewState, registry: ContentRegistry) {
  const area = registry.area(state.scene),
    radius = effectiveRadius(registry.actor(registry.definitions.player).radius);
  let p = supportedPosition(area, state.hero, radius);
  if (!isSupportedPosition(area, p, radius))
    p = area.entries.find((entry) => entry.id === area.baselineEntry)!;
  return {
    x: p.x,
    z: p.z,
    y: heightAt(area, p.x, p.z),
    py: heightAt(area, p.x, p.z),
    px: p.x,
    pz: p.z,
    yaw: state.hero.yaw,
  };
}
