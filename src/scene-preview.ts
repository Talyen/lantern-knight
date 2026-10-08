import { z } from 'zod';
import { supportedPosition, heightAt, type ContentRegistry } from './content/world';
const finite = z.number().finite();
const schema = z.object({
  version: z.literal(1),
  scene: z.string(),
  hero: z.object({ x: finite, z: finite, yaw: finite }),
  span: finite.min(1).max(100),
  scale: z.union([z.literal(1), z.literal(0.75), z.literal(0.5)]),
  paused: z.boolean(),
  mode: z.enum(['encounter', 'calibration', 'animation', 'occlusion', 'lighting']),
  look: z.object({
    rig: z.enum(['golden', 'silver']),
    look: z.enum(['ink', 'diorama', 'cinematic']),
    baseline: z.boolean(),
    lighting: z.boolean(),
    shadows: z.boolean(),
    atmosphere: z.boolean(),
    postprocessing: z.boolean(),
    strength: finite.min(0).max(2),
    depthOfField: finite.min(0).max(1),
  }),
});
export type ScenePreviewState = z.infer<typeof schema>;
export const previewKey = 'lantern-scene-preview-v1';
export function readScenePreview(
  text: string | null,
  registry: ContentRegistry,
): ScenePreviewState | undefined {
  try {
    const state = schema.parse(JSON.parse(text ?? 'null'));
    const area = registry.area(state.scene),
      p = supportedPosition(area, state.hero, 0.3);
    return { ...state, hero: { ...p, yaw: state.hero.yaw } };
  } catch {
    return undefined;
  }
}
export function previewHero(state: ScenePreviewState, registry: ContentRegistry) {
  const area = registry.area(state.scene),
    p = supportedPosition(area, state.hero, 0.3);
  return {
    ...p,
    y: heightAt(area, p.x, p.z),
    py: heightAt(area, p.x, p.z),
    px: p.x,
    pz: p.z,
    yaw: state.hero.yaw,
  };
}
