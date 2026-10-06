import {z} from 'zod';
import {content, type ContentRegistry, contains} from '../content/world';
import {tuning} from '../content/gameplay';
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const point = z
  .object({
    x: z.number().finite(),
    z: z.number().finite(),
    health: z.number().int().nonnegative(),
  })
  .strict();
export const GameSchema = z
  .object({
    version: z.literal(3),
    seed: z.number().int().min(0).max(4294967295),
    wins: z.number().int().nonnegative().max(100000),
    area: id,
    player: point.extend({
      cooldown: z.number().int().min(0).max(tuning.ability.cooldown),
      dodgeCooldown: z.number().int().min(0).max(tuning.dodge.cooldown),
    }),
    areas: z.record(
      id,
      z.object({cleared: z.boolean(), actors: z.record(id, point)}).strict(),
    ),
  })
  .strict();
export const SettingsSchema = z
  .object({
    version: z.literal(2),
    renderScale: z.number().min(0.5).max(1),
    showDebug: z.boolean(),
    verticalSpan: z.number().min(11).max(15),
  })
  .strict();
export type GameSave = z.infer<typeof GameSchema>;
export type SavedActor = z.infer<typeof point>;
export type SavedArea = GameSave['areas'][string];
export type Settings = z.infer<typeof SettingsSchema>;
export const SAVE_FORMAT_VERSION = 3;
export const SETTINGS_FORMAT_VERSION = 2;
export const SAVE_LIMITS = {game: 1024 * 1024, settings: 16 * 1024} as const;
const legacyPoint = point.extend({
  x: z.number().min(-7.5).max(7.5),
  z: z.number().min(-7.5).max(7.5),
  health: z.number().int().min(0).max(100),
});
const legacyFields = {
  seed: z.number().int().min(0).max(4294967295),
  wins: z.number().int().nonnegative().max(100000),
  hero: legacyPoint,
  enemies: z.array(legacyPoint).length(3),
};
const legacy = z
  .object({
    version: z.literal(2),
    area: z.union([z.literal(0), z.literal(1)]),
    ...legacyFields,
  })
  .strict();
export class SaveContentError extends Error {}
export function parseGame(
  value: unknown,
  registry: ContentRegistry = content,
): GameSave {
  if (typeof value === 'object' && value !== null && 'version' in value) {
    if (value.version === 0) {
      const v = z
        .object({
          version: z.literal(0),
          seed: z.number().int().nonnegative(),
          wins: z.number().int().nonnegative(),
        })
        .strict()
        .parse(value);
      value = {
        version: 2,
        area: 0,
        seed: v.seed,
        wins: v.wins,
        hero: {x: 0, z: 2.3, health: 100},
        enemies: [-2.5, 0.2, 2.9].map((x) => ({x, z: -3.5, health: 70})),
      };
    } else if (value.version === 1) {
      const v = z
        .object({version: z.literal(1), ...legacyFields})
        .strict()
        .parse(value);
      value = {...v, version: 2, area: 0};
    }
    if ((value as {version: number}).version === 2) {
      const v = legacy.parse(value),
        area = v.area === 0 ? 'court' : 'upper-landing';
      value = {
        version: 3,
        seed: v.seed,
        wins: v.wins,
        area,
        player: {...v.hero, cooldown: 0, dodgeCooldown: 0},
        areas: {
          [area]: {
            cleared: v.enemies.every((a) => a.health === 0),
            actors: Object.fromEntries(
              v.enemies.map((a, i) => [`warden-${i + 1}`, a]),
            ),
          },
        },
      };
    }
  }
  const save = GameSchema.parse(value),
    resolve = (id: string) => {
      try {
        return registry.area(id);
      } catch {
        throw new SaveContentError(`unknown area ${id}`);
      }
    },
    active = resolve(save.area),
    player = registry.actor(registry.definitions.player);
  if (
    !contains(active.bounds, save.player) ||
    save.player.health > player.maxHealth
  )
    throw new Error('invalid player state');
  if (!save.areas[save.area]) throw new Error('missing current area state');
  for (const [areaId, state] of Object.entries(save.areas)) {
    const area = resolve(areaId);
    if (
      Object.keys(state.actors).some(
        (id) => !area.spawns.some((s) => s.id === id),
      )
    )
      throw new SaveContentError(`unknown actor reference in ${areaId}`);
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
    if (
      state.cleared !== Object.values(state.actors).every((a) => a.health === 0)
    )
      throw new Error(`inconsistent clear state ${areaId}`);
  }
  return save;
}
export function parseSettings(value: unknown): Settings {
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version === 1
  ) {
    const v = z
      .object({
        version: z.literal(1),
        renderScale: z.number().min(0.5).max(1),
        showDebug: z.boolean(),
      })
      .strict()
      .parse(value);
    return SettingsSchema.parse({...v, version: 2, verticalSpan: 13});
  }
  return SettingsSchema.parse(value);
}
export type LoadResult<T> =
  | {status: 'empty'}
  | {status: 'ok' | 'recovered'; data: T}
  | {status: 'unreadable'; message: string};
export interface Bridge {
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
