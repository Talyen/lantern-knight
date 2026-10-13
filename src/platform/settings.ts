import { z } from 'zod';
import { visualEffectLabels, type VisualEffects } from '../content/visual-effects';
const VisualEffectsSchema = z.strictObject(
  Object.fromEntries(Object.keys(visualEffectLabels).map((k) => [k, z.boolean()])) as Record<
    keyof VisualEffects,
    z.ZodBoolean
  >,
);
const SettingsSchema = z.strictObject({
  version: z.literal(5),
  renderScale: z.number().min(0.5).max(1),
  showDebug: z.boolean(),
  verticalSpan: z.number().min(9).max(15),
  depthOfField: z.number().min(0).max(1),
  visualEffects: VisualEffectsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;
export function parseSettings(value: unknown): Settings {
  return SettingsSchema.parse(value);
}
