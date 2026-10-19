import { awarenessSchema, campfireSchema, interactableSchema, rewardSchema } from './interactions';
import { z } from 'zod';
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const coordinate = z.number().finite().min(-1000).max(1000);
const point = z.strictObject({ x: coordinate, z: coordinate });
const bounds = z
  .strictObject({ minX: coordinate, maxX: coordinate, minZ: coordinate, maxZ: coordinate })
  .refine((b) => b.minX < b.maxX && b.minZ < b.maxZ, 'Bounds must have positive dimensions');
export const AuthoredGameplaySchema = z
  .strictObject({
    spawns: z
      .array(
        point.extend({
          id,
          actor: id,
          jitterZ: z.number().finite().nonnegative().optional(),
          awareness: awarenessSchema.optional(),
          rewards: z.array(rewardSchema).optional(),
        }),
      )
      .max(100),
    exits: z
      .array(
        z.strictObject({
          id,
          trigger: bounds,
          destination: id,
          entry: id,
          requiresClear: z.boolean(),
          explicit: z.boolean().optional(),
          guards: z.array(id).optional(),
          marker: point,
        }),
      )
      .max(50),
    campfires: z
      .array(campfireSchema.extend({ object: id.optional() }))
      .max(30)
      .optional(),
    interactables: z.array(interactableSchema).max(100).optional(),
    pickups: z
      .array(
        point.extend({
          id,
          object: id,
          kind: z.literal('health'),
          amount: z.number().int().positive().max(1000),
          radius: z.number().finite().positive().max(10),
        }),
      )
      .max(100),
  })
  .superRefine((g, ctx) => {
    for (const [kind, values] of Object.entries(g))
      if (values && new Set(values.map((p) => p.id)).size !== values.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate ' + kind + ' identity' });
  });

export type AuthoredGameplay = z.infer<typeof AuthoredGameplaySchema>;

import type { SceneDocument } from './scene-document';
import type { AreaDefinition } from './world';
export function authoredGameplay(
  document: SceneDocument,
  area: AreaDefinition,
  positions: readonly { id: string; x: number; z: number }[] = [],
): AreaDefinition {
  const gameplay = document.gameplay;
  if (!gameplay) return area;
  const objects = new Map(positions.map((position) => [position.id, position]));
  const placed = <P extends { object: string; x: number; z: number }>(p: P): P => {
    const object = objects.get(p.object);
    return object ? { ...p, x: object.x, z: object.z } : p;
  };
  return {
    ...area,
    spawns: gameplay.spawns,
    campfires: gameplay.campfires?.map(({ object, ...fire }) => {
      const position = object && objects.get(object);
      return position ? { ...fire, x: position.x, z: position.z } : fire;
    }),
    interactables: gameplay.interactables?.map(placed),
    exits: gameplay.exits,
    pickups: gameplay.pickups.map(placed),
  };
}
