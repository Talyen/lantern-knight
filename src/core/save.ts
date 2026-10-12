import { z } from 'zod';
import { type ContentRegistry, contains, isSupportedPosition } from '../content/world';
import { tuning } from '../content/gameplay';
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const point = z
  .object({
    x: z.number().finite(),
    z: z.number().finite(),
    health: z.number().int().nonnegative(),
  })
  .strict();
const GameSchema = z
  .object({
    version: z.literal(6),
    seed: z.number().int().min(0).max(4294967295),
    wins: z.number().int().nonnegative().max(100000),
    area: id,
    player: point.extend({
      cooldown: z.number().int().min(0).max(tuning.ability.cooldown),
      dodgeCooldown: z.number().int().min(0).max(tuning.dodge.cooldown),
      nextAttack: z.enum(['sweep', 'lunge']).optional(),
    }),
    areas: z.record(
      id,
      z
        .object({
          cleared: z.boolean(),
          engaged: z.boolean(),
          actors: z.record(id, point),
          collectedPickups: z.array(id).optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type GameSave = z.infer<typeof GameSchema>;
export type SavedArea = GameSave['areas'][string];
export function parseGame(value: unknown, registry: ContentRegistry): GameSave {
  const save = GameSchema.parse(value),
    resolve = (id: string) => {
      try {
        return registry.area(id);
      } catch {
        throw new Error(`unknown area ${id}`);
      }
    },
    active = resolve(save.area),
    player = registry.actor(registry.definitions.player);
  if (!contains(active.bounds, save.player) || save.player.health > player.maxHealth)
    throw new Error('invalid player state');
  if (!save.areas[save.area]) throw new Error('missing current area state');
  for (const [areaId, state] of Object.entries(save.areas)) {
    const area = resolve(areaId);
    if (Object.keys(state.actors).some((id) => !area.spawns.some((s) => s.id === id)))
      throw new Error(`unknown actor reference in ${areaId}`);
    if (Object.keys(state.actors).length !== area.spawns.length)
      throw new Error(`actor count differs in ${areaId}`);
    if (
      state.collectedPickups &&
      (new Set(state.collectedPickups).size !== state.collectedPickups.length ||
        state.collectedPickups.some((id) => !area.pickups?.some((p) => p.id === id)))
    )
      throw new Error('Unknown or duplicate collected pickup');
    for (const spawn of area.spawns) {
      const actor = state.actors[spawn.id];
      if (
        !actor ||
        !contains(area.bounds, actor) ||
        actor.health > registry.actor(spawn.actor).maxHealth
      )
        throw new Error(`invalid actor ${areaId}/${spawn.id}`);
    }
    if (state.cleared !== Object.values(state.actors).every((a) => a.health === 0))
      throw new Error(`inconsistent clear state ${areaId}`);
  }
  if (!isSupportedPosition(active, save.player, player.radius))
    throw new Error('Unsupported saved player position');
  for (const [areaId, state] of Object.entries(save.areas)) {
    const area = resolve(areaId);
    for (const spawn of area.spawns)
      if (!isSupportedPosition(area, state.actors[spawn.id]!, registry.actor(spawn.actor).radius))
        throw new Error('Unsupported saved actor position');
  }
  return save;
}
