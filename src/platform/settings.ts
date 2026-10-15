import { defaultAudioSettings } from '../content/audio';
import { z } from 'zod';
import { visualEffectLabels, type VisualEffects } from '../content/visual-effects';
const VisualEffectsSchema = z.strictObject(
  Object.fromEntries(Object.keys(visualEffectLabels).map((k) => [k, z.boolean()])) as Record<
    keyof VisualEffects,
    z.ZodBoolean
  >,
);
const SettingsSchema = z.strictObject({
  version: z.literal(6),
  audio: z.strictObject({
    master: z.number().min(0).max(1),
    effects: z.number().min(0).max(1),
    ambience: z.number().min(0).max(1),
    muted: z.boolean(),
  }),
  renderScale: z.number().min(0.5).max(1),
  showDebug: z.boolean(),
  verticalSpan: z.number().min(8.55).max(15),
  depthOfField: z.number().min(0).max(1),
  visualEffects: VisualEffectsSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;
export function parseSettings(value: unknown): Settings {
  const legacy = SettingsSchema.omit({ audio: true, version: true }).extend({
    version: z.literal(5),
  });
  const previous = legacy.safeParse(value);
  return SettingsSchema.parse(
    previous.success ? { ...previous.data, version: 6, audio: { ...defaultAudioSettings } } : value,
  );
}
