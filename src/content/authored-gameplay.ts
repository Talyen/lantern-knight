import { awarenessSchema, campfireSchema, interactableSchema, rewardSchema } from './interactions';
import { z } from 'zod';
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const coordinate = z.number().finite().min(-1000).max(1000);
const point = z.object({ x: coordinate, z: coordinate }).strict();
const bounds = z
  .object({ minX: coordinate, maxX: coordinate, minZ: coordinate, maxZ: coordinate })
  .strict()
  .refine((b) => b.minX < b.maxX && b.minZ < b.maxZ, 'Bounds must have positive dimensions');
export const AuthoredGameplaySchema = z
  .object({
    spawns: z
      .array(
        point
          .extend({
            id,
            actor: id,
            jitterZ: z.number().finite().nonnegative().optional(),
            awareness: awarenessSchema.optional(),
            rewards: z.array(rewardSchema).optional(),
          })
          .strict(),
      )
      .max(100),
    exits: z
      .array(
        z
          .object({
            id,
            trigger: bounds,
            destination: id,
            entry: id,
            requiresClear: z.boolean(),
            explicit: z.boolean().optional(),
            guards: z.array(id).optional(),
            marker: point,
          })
          .strict(),
      )
      .max(50),
    campfires: z.array(campfireSchema).max(30).optional(),
    interactables: z.array(interactableSchema).max(100).optional(),
    pickups: z
      .array(
        point
          .extend({
            id,
            object: id,
            kind: z.literal('health'),
            amount: z.number().int().positive().max(1000),
            radius: z.number().finite().positive().max(10),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((g, ctx) => {
    for (const [kind, values] of Object.entries(g))
      if (values && new Set(values.map((p) => p.id)).size !== values.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate ' + kind + ' identity' });
  });

import type { SceneDocument } from './scene-document';
import type { AreaDefinition } from './world';
export function authoredGameplay(
  document: SceneDocument,
  area: AreaDefinition,
  positions: readonly { id: string; x: number; z: number }[] = [],
): AreaDefinition {
  const gameplay = document.gameplay;
  return gameplay
    ? {
        ...area,
        spawns: gameplay.spawns,
        campfires: gameplay.campfires,
        interactables: gameplay.interactables?.map((p) => {
          const object = positions.find((v) => v.id === p.object);
          return object ? { ...p, x: object.x, z: object.z } : p;
        }),
        exits: gameplay.exits,
        pickups: gameplay.pickups.map((p) => {
          const object = positions.find((v) => v.id === p.object);
          return object ? { ...p, x: object.x, z: object.z } : p;
        }),
      }
    : area;
}
