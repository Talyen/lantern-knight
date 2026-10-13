import { items, equipmentSlots, healthBonus } from '../content/items';
import { rewardSchema } from '../content/interactions';
import { z } from 'zod';
import { type ContentRegistry, contains, isSupportedPosition } from '../content/world';
import { effectiveRadius } from '../content/collision';
import { tuning } from '../content/gameplay';
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const point = z.strictObject({
  x: z.number().finite(),
  z: z.number().finite(),
  health: z.number().int().nonnegative(),
});
const GameSchema = z.strictObject({
  version: z.literal(7),
  seed: z.number().int().min(0).max(4294967295),
  wins: z.number().int().nonnegative().max(100000),
  area: id,
  player: point.extend({
    cooldown: z.number().int().min(0).max(tuning.ability.cooldown),
    dodgeCooldown: z.number().int().min(0).max(tuning.dodge.cooldown),
    nextAttack: z.enum(['sweep', 'lunge']).optional(),
  }),
  adventure: z
    .strictObject({
      inventory: z.record(id, z.number().int().nonnegative().max(100000000)),
      equipment: z.partialRecord(z.enum(equipmentSlots), id),
      discovered: z.array(z.string()).max(1000),
      lastFire: z.string().optional(),
      potionCooldown: z.number().int().min(0).max(60),
    })
    .optional(),
  areas: z.record(
    id,
    z.strictObject({
      cleared: z.boolean(),
      engaged: z.boolean(),
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
            rewards: z.array(rewardSchema),
          }),
        )
        .max(1000)
        .optional(),
    }),
  ),
});
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
  if (
    !contains(active.bounds, save.player) ||
    save.player.health > player.maxHealth + healthBonus(save.adventure?.equipment ?? {})
  )
    throw new Error('invalid player state');
  if (save.adventure) {
    const { inventory, equipment, discovered, lastFire } = save.adventure;
    for (const [item, amount] of Object.entries(inventory))
      if (!items[item] || !Number.isSafeInteger(amount)) throw new Error('Unknown inventory item');
    const used: Record<string, number> = {};
    for (const [slot, item] of Object.entries(equipment)) {
      if (!items[item]?.slots?.includes(slot as (typeof equipmentSlots)[number]))
        throw new Error('Incompatible equipment');
      used[item] = (used[item] ?? 0) + 1;
      if (used[item]! > (inventory[item] ?? 0)) throw new Error('Equipment not owned');
    }
    const fires = registry.definitions.areas.flatMap((a) =>
      (a.campfires ?? []).map((f) => a.id + '/' + f.id),
    );
    if (
      new Set(discovered).size !== discovered.length ||
      discovered.some((f) => !fires.includes(f)) ||
      (lastFire && !discovered.includes(lastFire))
    )
      throw new Error('Unknown campfire');
  }
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
        const rewards = source?.rewards;
        if (
          !source ||
          !isSupportedPosition(area, drop, 0.01) ||
          JSON.stringify(rewards) !== JSON.stringify(drop.rewards) ||
          drop.id !== (drop.enemy ? 'enemy-' : 'object-') + drop.source ||
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
        actor.health > registry.actor(spawn.actor).maxHealth
      )
        throw new Error(`invalid actor ${areaId}/${spawn.id}`);
    }
    if (state.cleared !== Object.values(state.actors).every((a) => a.health === 0))
      throw new Error(`inconsistent clear state ${areaId}`);
  }
  if (!isSupportedPosition(active, save.player, effectiveRadius(player.radius)))
    throw new Error('Unsupported saved player position');
  for (const [areaId, state] of Object.entries(save.areas)) {
    const area = resolve(areaId);
    for (const spawn of area.spawns)
      if (
        !isSupportedPosition(
          area,
          state.actors[spawn.id]!,
          effectiveRadius(registry.actor(spawn.actor).radius),
        )
      )
        throw new Error('Unsupported saved actor position');
  }
  return save;
}
