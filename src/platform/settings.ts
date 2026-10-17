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
  version: z.literal(7),
  uiScale: z.union([z.literal(0.9), z.literal(1), z.literal(1.15)]),
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
const PreviousSettingsSchema = SettingsSchema.omit({ version: true, uiScale: true }).extend({
  version: z.literal(6),
});
const LegacySettingsSchema = PreviousSettingsSchema.omit({ audio: true, version: true }).extend({
  version: z.literal(5),
});
export type Settings = z.infer<typeof SettingsSchema>;
export function parseSettings(value: unknown): Settings {
  const legacy = LegacySettingsSchema.safeParse(value);
  const previous = PreviousSettingsSchema.safeParse(
    legacy.success ? { ...legacy.data, version: 6, audio: { ...defaultAudioSettings } } : value,
  );
  return SettingsSchema.parse(
    previous.success ? { ...previous.data, version: 7, uiScale: 1 } : value,
  );
}
