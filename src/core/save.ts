import { z } from 'zod';
import { visualEffectLabels, type VisualEffects } from '../content/visual-effects';
const VisualEffectsSchema = z
  .object(
    Object.fromEntries(Object.keys(visualEffectLabels).map((k) => [k, z.boolean()])) as Record<
      keyof VisualEffects,
      z.ZodBoolean
    >,
  )
  .strict();
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
    }),
    areas: z.record(
      id,
      z
        .object({ cleared: z.boolean(), engaged: z.boolean(), actors: z.record(id, point) })
        .strict(),
    ),
  })
  .strict();
const SettingsSchema = z
  .object({
    version: z.literal(5),
    renderScale: z.number().min(0.5).max(1),
    showDebug: z.boolean(),
    verticalSpan: z.number().min(9).max(15),
    depthOfField: z.number().min(0).max(1),
    visualEffects: VisualEffectsSchema,
  })
  .strict();
export type GameSave = z.infer<typeof GameSchema>;
export type SavedArea = GameSave['areas'][string];
export type Settings = z.infer<typeof SettingsSchema>;
export const SAVE_LIMITS = { game: 1024 * 1024, settings: 16 * 1024 } as const;
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
export function parseSettings(value: unknown): Settings {
  return SettingsSchema.parse(value);
}
export type LoadResult<T> = { status: 'empty' } | { status: 'ok'; data: T };
export interface Bridge {
  readonly automatedRun?: boolean;
  launchMode?(mode: 'game' | 'sandbox' | 'effects' | 'editor'): Promise<void>;
  loadSettings(): Promise<LoadResult<Settings>>;
  saveSettings(value: Settings): Promise<void>;
  loadGame(): Promise<LoadResult<GameSave>>;
  saveGame(value: GameSave): Promise<void>;
}
declare global {
  interface Window {
    lantern?: Bridge;
  }
}
