import { z } from 'zod';
import { items } from './items';
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const coordinate = z.number().finite().min(-1000).max(1000);
export const rewardSchema = z
  .object({
    item: z.string().refine((s) => Boolean(items[s]), 'Unknown item'),
    amount: z.number().int().positive().max(100000),
  })
  .strict();
export const awarenessSchema = z
  .object({
    radius: z.number().positive().max(30),
    leash: z.number().positive().max(40),
    group: id.optional(),
  })
  .strict();
export const campfireSchema = z
  .object({
    id,
    name: z.string().min(1).max(80),
    x: coordinate,
    z: coordinate,
    safeRadius: z.number().positive().max(10),
    discovered: z.boolean().optional(),
  })
  .strict();
export const interactableSchema = z
  .object({
    id,
    object: id,
    kind: z.enum(['breakable', 'container']),
    x: coordinate,
    z: coordinate,
    guards: z.array(id).max(20),
    rewards: z.array(rewardSchema).max(20),
    idle: z.string(),
    action: z.string(),
    spent: z.string(),
  })
  .strict();
export type CampfireDefinition = z.infer<typeof campfireSchema>;
export type InteractableDefinition = Omit<
  z.infer<typeof interactableSchema>,
  'guards' | 'rewards'
> & { guards: readonly string[]; rewards: readonly import('./items').Reward[] };
export type AwarenessDefinition = z.infer<typeof awarenessSchema>;
export type GroundDrop = {
  id: string;
  source: string;
  enemy: boolean;
  x: number;
  z: number;
  rewards: z.infer<typeof rewardSchema>[];
};
