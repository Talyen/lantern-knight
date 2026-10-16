import { z } from 'zod';
import { rewardSchema } from '../content/interactions';
import {
  type ContentRegistry,
  type AreaDefinition,
  type Point,
  contains,
  isSupportedPosition,
} from '../content/world';
import { effectiveRadius, supportedPosition, clearSegment } from '../content/collision';
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
    .optional(),
});
export type AreaState = z.infer<typeof AreaStateSchema>;

// Preserve checkpoints made before a painting gained its inner framing margin.
// Only the old clear floor is eligible; walls and invalid coordinates still fail.
export function restoreScenePosition(area: AreaDefinition, point: Point, radius: number) {
  if (isSupportedPosition(area, point, radius)) return true;
  if (!area.sceneBoundary) return false;
  const previous = { ...area, playableBoundary: area.sceneBoundary };
  if (!isSupportedPosition(previous, point, radius)) return false;
  let corrected = supportedPosition(area, point, radius);
  const clear = (candidate: Point) =>
    isSupportedPosition(area, candidate, radius) &&
    clearSegment(previous, point, candidate, radius);
  if (!clear(corrected)) {
    // The nearest boundary point can overlap painted collision. Search nearby
    // clear footing without crossing a wall or changing checkpoint progress.
    let found: Point | undefined;
    for (let distance = 0.2; distance <= 6 && !found; distance += 0.2)
      for (let i = 0; i < 64; i++) {
        const candidate = {
          x: point.x + Math.cos((i * Math.PI) / 32) * distance,
          z: point.z + Math.sin((i * Math.PI) / 32) * distance,
        };
        if (clear(candidate)) {
          found = candidate;
          break;
        }
      }
    if (!found) return false;
    corrected = found;
  }
  Object.assign(point, corrected);
  return true;
}

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
      state.claimedObjects.some(
        (id) => !area.interactables?.some((p) => p.id === id && p.kind !== 'workbench'),
      ))
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
        !restoreScenePosition(area, drop, 0.01) ||
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
      (actor.burn && actor.health === 0)
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
      !restoreScenePosition(
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
