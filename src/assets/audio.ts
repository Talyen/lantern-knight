import { z } from 'zod';
export const audioManifestPath = 'audio/manifest.json';
const sample = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  cue: z.string().regex(/^[a-z0-9-]+$/),
  path: z.string().regex(/^audio\/[a-f0-9]{64}\.(wav|ogg)$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
  duration: z.number().finite().positive().max(30),
  channels: z.union([z.literal(1), z.literal(2)]),
  sampleRate: z.union([z.literal(44100), z.literal(48000)]),
  loop: z.boolean(),
  loopStart: z.number().finite().nonnegative(),
  loopEnd: z.number().finite().positive(),
});
const schema = z.strictObject({ schemaVersion: z.literal(1), samples: z.array(sample).max(256) });
export type AudioManifest = z.infer<typeof schema>;
export type AudioSample = AudioManifest['samples'][number];
export function parseAudioManifest(value: unknown): AudioManifest {
  const manifest = schema.parse(value),
    ids = new Set<string>();
  for (const sample of manifest.samples) {
    if (
      ids.has(sample.id) ||
      sample.loopStart >= sample.loopEnd ||
      sample.loopEnd > sample.duration + 0.001
    )
      throw new Error('Invalid audio identity or loop: ' + sample.id);
    if (sample.path !== `audio/${sample.hash}.${sample.loop ? 'ogg' : 'wav'}`)
      throw new Error('Audio path does not match its content: ' + sample.id);
    ids.add(sample.id);
  }
  return manifest;
}
