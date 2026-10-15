import { z } from 'zod';
import { rewardSchema } from '../content/interactions';
import { type ContentRegistry, contains, isSupportedPosition } from '../content/world';
import { effectiveRadius } from '../content/collision';
import type { ContentSnapshot } from '../content/snapshot';
import { tuning } from '../content/gameplay';
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const point = z.strictObject({
  x: z.number().finite(),
  z: z.number().finite(),
  health: z.number().int().nonnegative(),
  burn: z
    .strictObject({
      remaining: z.number().int().positive().max(tuning.ability.burnDuration),
      nextTick: z.number().int().positive().max(tuning.ability.burnCadence),
    })
    .optional(),
});
export const AreaStateSchema = z.strictObject({
  cleared: z.boolean(),
  engaged: z.boolean(),
  alerted: z.array(id).optional(),
  actors: z.record(id, point),
  collectedPickups: z.array(id).optional(),
  claimedObjects: z.array(id).optional(),
  drops: z
    .array(
      z.strictObject({
        id,
        source: id,
        enemy: z.boolean(),
        x: z.number().finite(),
        z: z.number().finite(),
        rewards: z.array(rewardSchema).length(1),
      }),
    )
    .max(1000)
    .optional(),
});
export type AreaState = z.infer<typeof AreaStateSchema>;

// Admission is shared by checkpoints and simulation construction. Returns a
// detached state so neither caller drafts nor borrowed views become live state.
export function parseAreaState(
  value: unknown,
  registry: ContentRegistry,
  areaId: string,
): AreaState {
  const state = AreaStateSchema.parse(value),
    area = registry.area(areaId);

  if (Object.keys(state.actors).some((id) => !area.spawns.some((s) => s.id === id)))
    throw new Error(`unknown actor reference in ${area.id}`);
  if (Object.keys(state.actors).length !== area.spawns.length)
    throw new Error(`actor count differs in ${area.id}`);
  if (
    state.collectedPickups &&
    (new Set(state.collectedPickups).size !== state.collectedPickups.length ||
      state.collectedPickups.some((id) => !area.pickups?.some((p) => p.id === id)))
  )
    throw new Error('Unknown or duplicate collected pickup');
  if (
    state.claimedObjects &&
    (new Set(state.claimedObjects).size !== state.claimedObjects.length ||
      state.claimedObjects.some((id) => !area.interactables?.some((p) => p.id === id)))
  )
    throw new Error('Unknown claimed object');
  if (state.drops) {
    if (new Set(state.drops.map((d) => d.id)).size !== state.drops.length)
      throw new Error('Duplicate drop');
    for (const drop of state.drops) {
      const source = drop.enemy
        ? area.spawns.find((p) => p.id === drop.source)
        : area.interactables?.find((p) => p.id === drop.source);
      const prefix = (drop.enemy ? 'enemy-' : 'object-') + drop.source + '-';
      const index = drop.id.startsWith(prefix) ? Number(drop.id.slice(prefix.length)) : -1;
      const reward = Number.isInteger(index) && index >= 0 ? source?.rewards?.[index] : undefined;
      if (
        !source ||
        !isSupportedPosition(area, drop, 0.01) ||
        !reward ||
        reward.item !== drop.rewards[0]!.item ||
        reward.amount !== drop.rewards[0]!.amount ||
        drop.id !== prefix + index ||
        (!drop.enemy && !state.claimedObjects?.includes(drop.source)) ||
        (drop.enemy && state.actors[drop.source]?.health !== 0)
      )
        throw new Error('Invalid drop');
    }
  }
  for (const spawn of area.spawns) {
    const actor = state.actors[spawn.id];
    if (
      !actor ||
      !contains(area.bounds, actor) ||
      actor.health > registry.actor(spawn.actor).maxHealth ||
      (actor.burn && (actor.health === 0 || actor.burn.nextTick > actor.burn.remaining))
    )
      throw new Error(`invalid actor ${area.id}/${spawn.id}`);
  }
  if (state.cleared !== Object.values(state.actors).every((a) => a.health === 0))
    throw new Error(`inconsistent clear state ${area.id}`);
  if (
    state.alerted &&
    (new Set(state.alerted).size !== state.alerted.length ||
      state.alerted.some((id) => !area.spawns.some((spawn) => spawn.id === id)))
  )
    throw new Error('Unknown or duplicate alerted enemy');
  for (const spawn of area.spawns)
    if (
      !isSupportedPosition(
        area,
        state.actors[spawn.id]!,
        effectiveRadius(registry.actor(spawn.actor).radius),
      )
    )
      throw new Error('Unsupported saved actor position');
  return state;
}

// Rest/death reset encounters but retain permanent world progress.
export function respawnAreaState(
  previous: ContentSnapshot<AreaState>,
  initial: AreaState,
): AreaState {
  return AreaStateSchema.parse({
    ...previous,
    actors: initial.actors,
    cleared: initial.cleared,
    engaged: initial.engaged,
    alerted: [],
    drops: previous.drops?.filter((drop) => !drop.enemy),
  });
}
