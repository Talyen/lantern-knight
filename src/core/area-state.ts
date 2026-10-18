import { z } from 'zod';
import { rewardSchema } from '../content/interactions';
import { type ContentRegistry, type AreaDefinition, type Point } from '../content/world';
import { contains, isSupportedPosition } from '../content/collision';
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
const AreaStateSchema = z.strictObject({
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

function uniqueReferences(ids: readonly string[] = [], known: ReadonlySet<string>) {
  return new Set(ids).size === ids.length && ids.every((id) => known.has(id));
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

  const spawns = new Map(area.spawns.map((spawn) => [spawn.id, spawn])),
    objects = new Map(area.interactables?.map((object) => [object.id, object]));
  if (Object.keys(state.actors).some((id) => !spawns.has(id)))
    throw new Error(`unknown actor reference in ${area.id}`);
  if (Object.keys(state.actors).length !== spawns.size)
    throw new Error(`actor count differs in ${area.id}`);
  if (!uniqueReferences(state.collectedPickups, new Set(area.pickups?.map((p) => p.id))))
    throw new Error('Unknown or duplicate collected pickup');
  const claimed = new Set(state.claimedObjects);
  if (!uniqueReferences(state.claimedObjects, new Set([...objects.values()].map((o) => o.id))))
    throw new Error('Unknown claimed object');
  if (state.drops) {
    if (new Set(state.drops.map((d) => d.id)).size !== state.drops.length)
      throw new Error('Duplicate drop');
    for (const drop of state.drops) {
      const source = drop.enemy ? spawns.get(drop.source) : objects.get(drop.source);
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
        (!drop.enemy && !claimed.has(drop.source)) ||
        (drop.enemy && state.actors[drop.source]?.health !== 0)
      )
        throw new Error('Invalid drop');
    }
  }
  for (const spawn of area.spawns) {
    const actor = state.actors[spawn.id],
      definition = registry.actor(spawn.actor);
    if (
      !actor ||
      !contains(area.bounds, actor) ||
      actor.health > definition.maxHealth ||
      (actor.burn && actor.health === 0)
    )
      throw new Error(`invalid actor ${area.id}/${spawn.id}`);
    if (!restoreScenePosition(area, actor, effectiveRadius(definition.radius)))
      throw new Error('Unsupported saved actor position');
  }
  if (state.cleared !== Object.values(state.actors).every((a) => a.health === 0))
    throw new Error(`inconsistent clear state ${area.id}`);
  if (!uniqueReferences(state.alerted, new Set(spawns.keys())))
    throw new Error('Unknown or duplicate alerted enemy');
  return state;
}

// Rest/death reset encounters but retain permanent world progress.
export function respawnAreaState(
  previous: ContentSnapshot<AreaState>,
  initial: AreaState,
): AreaState {
  return structuredClone({
    ...previous,
    actors: initial.actors,
    cleared: initial.cleared,
    engaged: initial.engaged,
    alerted: [],
    drops: previous.drops?.filter((drop) => !drop.enemy),
  }) as AreaState;
}
