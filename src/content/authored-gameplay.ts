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
      .array(point.extend({ id, actor: id, jitterZ: z.number().finite().nonnegative().optional() }))
      .max(100),
    exits: z
      .array(
        z.strictObject({
          id,
          trigger: bounds,
          destination: id,
          entry: id,
          requiresClear: z.boolean(),
          marker: point,
        }),
      )
      .max(50),
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
      if (new Set(values.map((p) => p.id)).size !== values.length)
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
  return gameplay
    ? {
        ...area,
        spawns: gameplay.spawns,
        exits: gameplay.exits,
        pickups: gameplay.pickups.map((p) => {
          const object = positions.find((v) => v.id === p.object);
          return object ? { ...p, x: object.x, z: object.z } : p;
        }),
      }
    : area;
}
