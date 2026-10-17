import { equipmentSlots, healthBonus } from '../content/items';
import { validateInventory, MAX_ITEM_COUNT } from './inventory';
import { type AreaState, parseAreaState, restoreScenePosition } from './area-state';
import { z } from 'zod';
import { OnboardingSchema } from './onboarding';
import { type ContentRegistry, contains } from '../content/world';
import { effectiveRadius } from '../content/collision';
import { tuning } from '../content/gameplay';
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const point = z.strictObject({
  x: z.number().finite(),
  z: z.number().finite(),
  health: z.number().int().nonnegative(),
});
const GameSchema = z.strictObject({
  version: z.literal(9),
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
      inventory: z.record(id, z.number().int().nonnegative().max(MAX_ITEM_COUNT)),
      equipment: z.partialRecord(z.enum(equipmentSlots), id),
      forgeUpgrade: z.enum(['sword', 'lantern']).optional(),
      discovered: z.array(z.string()).max(1000),
      lastFire: z.string().optional(),
      potionCooldown: z.number().int().min(0).max(60),
      onboarding: OnboardingSchema.optional(),
    })
    .optional(),
  areas: z.record(id, z.unknown()),
});
export type GameSave = Omit<z.infer<typeof GameSchema>, 'areas'> & {
  areas: Record<string, AreaState>;
};
export function parseGame(value: unknown, registry: ContentRegistry): GameSave {
  const save = GameSchema.parse(value),
    active = registry.area(save.area),
    player = registry.actor(registry.definitions.player);
  if (
    !contains(active.bounds, save.player) ||
    save.player.health > player.maxHealth + healthBonus(save.adventure?.equipment ?? {})
  )
    throw new Error('invalid player state');
  if (!save.adventure && registry.definitions.areas.some((area) => area.campfires?.length))
    throw new Error('Missing adventure state');
  if (save.adventure) {
    const { discovered, lastFire } = save.adventure,
      discoveredIds = new Set(discovered);
    validateInventory(save.adventure);
    const fires = new Set(
      registry.definitions.areas.flatMap((a) => (a.campfires ?? []).map((f) => a.id + '/' + f.id)),
    );
    if (
      discoveredIds.size !== discovered.length ||
      discovered.some((f) => !fires.has(f)) ||
      (lastFire !== undefined && !discoveredIds.has(lastFire))
    )
      throw new Error('Unknown campfire');
  }
  if (!Object.hasOwn(save.areas, save.area)) throw new Error('missing current area state');
  // Area admission owns its schema parse and detached result. Parsing it here
  // as well would clone every actor and drop twice.
  const areas = Object.fromEntries(
    Object.entries(save.areas).map(([areaId, state]) => [
      areaId,
      parseAreaState(state, registry, areaId),
    ]),
  );

  if (!restoreScenePosition(active, save.player, effectiveRadius(player.radius)))
    throw new Error('Unsupported saved player position');

  return { ...save, areas };
}
