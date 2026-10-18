import { z } from 'zod';

const factor = z.number().finite().positive();
export const ActorScaleSchema = z.strictObject({
  baseline: z.string().min(1),
  notes: z.string().min(1),
  clips: z.record(z.string(), factor),
  frames: z.record(z.string(), factor),
});

export function actorFrameScales(
  recipe: unknown,
  clips: readonly { id: string; heading: string; frames: readonly string[] }[],
) {
  const scale = ActorScaleSchema.parse(recipe);
  const keys = clips.map((clip) => `${clip.id}:${clip.heading}`);
  if (
    keys.length !== Object.keys(scale.clips).length ||
    keys.some((key) => !Object.hasOwn(scale.clips, key))
  )
    throw new Error('Actor scale review must cover exactly the delivered clips/directions');
  const frames = new Map<string, number>();
  for (const clip of clips)
    for (const id of clip.frames) {
      const value =
        scale.clips[`${clip.id}:${clip.heading}`]! *
        (Object.hasOwn(scale.frames, id) ? scale.frames[id]! : 1);
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid actor scale: ' + id);
      if (frames.has(id) && frames.get(id) !== value)
        throw new Error('Conflicting actor frame scale: ' + id);
      frames.set(id, value);
    }
  for (const id of Object.keys(scale.frames))
    if (!frames.has(id)) throw new Error('Unknown actor scale drawing: ' + id);
  return frames;
}

// Keep pixel-space landmarks and the native foot pivot; density alone sets world size.
export function scaleActorRegistration<T extends { density: number }>(native: T, scale: number): T {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid actor scale');
  return { ...native, density: native.density / scale };
}
