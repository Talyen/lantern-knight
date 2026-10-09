import { z } from 'zod';
import {
  visualEffectLabels,
  defaultVisualEffects,
  type VisualEffects,
} from '../content/visual-effects';
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
export const SAVE_FORMAT_VERSION = 6;
export const SETTINGS_FORMAT_VERSION = 5;
export const SAVE_LIMITS = { game: 1024 * 1024, settings: 16 * 1024 } as const;
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
export function parseGame(value: unknown, registry: ContentRegistry): GameSave {
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
        hero: { x: 0, z: 2.3, health: 100 },
        enemies: [-2.5, 0.2, 2.9].map((x) => ({ x, z: -3.5, health: 70 })),
      };
    } else if (value.version === 1) {
      const v = z
        .object({ version: z.literal(1), ...legacyFields })
        .strict()
        .parse(value);
      value = { ...v, version: 2, area: 0 };
    }
    if ((value as { version: number }).version === 2) {
      const v = legacy.parse(value),
        area = v.area === 0 ? 'court' : 'upper-landing';
      value = {
        version: 3,
        seed: v.seed,
        wins: v.wins,
        area,
        player: { ...v.hero, cooldown: 0, dodgeCooldown: 0 },
        areas: {
          [area]: {
            cleared: v.enemies.every((a) => a.health === 0),
            actors: Object.fromEntries(v.enemies.map((a, i) => [`warden-${i + 1}`, a])),
          },
        },
      };
    }
  }
  if ((value as { version?: number })?.version === 3) {
    // Only recognize the shipped prototype content. Unknown references stay protected.
    const previous = GameSchema.omit({ version: true, areas: true })
      .extend({
        version: z.literal(3),
        areas: z.record(
          id,
          z.object({ cleared: z.boolean(), actors: z.record(id, point) }).strict(),
        ),
      })
      .parse(value);
    const areas: Record<string, SavedArea> = {};
    for (const [areaId, state] of Object.entries(previous.areas)) {
      if (!['court', 'upper-landing'].includes(areaId))
        throw new SaveContentError(`unknown prototype area ${areaId}`);
      const keys = Object.keys(state.actors).sort();
      if (keys.join(',') !== 'warden-1,warden-2,warden-3')
        throw new SaveContentError('unknown prototype actor references');
      for (const actor of Object.values(state.actors))
        if (actor.health > 70 || actor.x < -7.5 || actor.x > 7.5 || actor.z < -7.5 || actor.z > 7.5)
          throw new Error('invalid prototype actor');
      if (state.cleared !== Object.values(state.actors).every((a) => a.health === 0))
        throw new Error('inconsistent prototype clear');
      const area = registry.area(areaId);
      areas[areaId] = {
        cleared: state.cleared,
        engaged: state.cleared,
        actors: Object.fromEntries(
          area.spawns.map((spawn) => [
            spawn.id,
            {
              x: spawn.x,
              z: spawn.z,
              health: state.cleared ? 0 : registry.actor(spawn.actor).maxHealth,
            },
          ]),
        ),
      };
    }
    if (!areas[previous.area]) throw new Error('missing current prototype area');
    const area = registry.area(previous.area),
      player = { ...previous.player };
    if (
      player.x < -7.5 ||
      player.x > 7.5 ||
      player.z < -7.5 ||
      player.z > 7.5 ||
      player.health > registry.actor(registry.definitions.player).maxHealth
    )
      throw new Error('invalid prototype player');
    if (!isSupportedPosition(area, player, 0.3)) {
      const entry = area.entries.find((e) => e.id === area.baselineEntry)!;
      player.x = entry.x;
      player.z = entry.z;
    }
    value = { ...previous, version: 4, player, areas };
  }
  if ((value as { version?: number })?.version === 4) {
    const previous = GameSchema.omit({ version: true })
      .extend({ version: z.literal(4) })
      .parse(value);
    const areas: Record<string, SavedArea> = {};
    for (const [areaId, state] of Object.entries(previous.areas)) {
      if (!['court', 'upper-landing'].includes(areaId))
        throw new SaveContentError(`unknown previous layout ${areaId}`);
      const expected = areaId === 'court' ? ['warden-1'] : ['warden-1', 'warden-2'];
      if (Object.keys(state.actors).sort().join() !== expected.join())
        throw new SaveContentError('unknown previous layout actors');
      for (const actor of Object.values(state.actors))
        if (actor.health > 50 || Math.abs(actor.x) > 7.5 || Math.abs(actor.z) > 7.5)
          throw new Error('invalid previous actor state');
      if (state.cleared !== Object.values(state.actors).every((a) => a.health === 0))
        throw new Error('inconsistent previous clear state');
      const area = registry.area(areaId);
      areas[areaId] = {
        cleared: state.cleared,
        engaged: state.cleared,
        actors: Object.fromEntries(
          area.spawns.map((spawn) => [
            spawn.id,
            {
              x: spawn.x,
              z: spawn.z,
              health: state.cleared ? 0 : registry.actor(spawn.actor).maxHealth,
            },
          ]),
        ),
      };
    }
    if (!areas[previous.area]) throw new Error('missing active area');
    const player = { ...previous.player },
      area = registry.area(previous.area),
      entry = area.entries.find((e) => e.id === area.baselineEntry)!;
    if (Math.abs(player.x) > 7.5 || Math.abs(player.z) > 7.5 || player.health > 100)
      throw new Error('invalid previous player');
    // All v4 positions describe the discarded layout. Start safely at its named entry.
    player.x = entry.x;
    player.z = entry.z;
    value = { ...previous, version: 5, player, areas };
  }
  // Validate v5 against its shipped chapel bounds before reconciling the narrower room.
  const previousChapel = (value as { version?: number })?.version === 5;
  if (previousChapel) {
    const previous = GameSchema.extend({ version: z.literal(5) }).parse(value);
    value = { ...previous, version: 6 };
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
    !contains(
      previousChapel && active.id === 'upper-landing'
        ? { minX: -7.7, maxX: 7.7, minZ: -8.7, maxZ: 8.7 }
        : active.bounds,
      save.player,
    ) ||
    save.player.health > player.maxHealth
  )
    throw new Error('invalid player state');
  if (!save.areas[save.area]) throw new Error('missing current area state');
  for (const [areaId, state] of Object.entries(save.areas)) {
    const area = resolve(areaId);
    if (Object.keys(state.actors).some((id) => !area.spawns.some((s) => s.id === id)))
      throw new SaveContentError(`unknown actor reference in ${areaId}`);
    if (Object.keys(state.actors).length !== area.spawns.length)
      throw new Error(`actor count differs in ${areaId}`);
    for (const spawn of area.spawns) {
      const actor = state.actors[spawn.id];
      if (
        !actor ||
        !contains(
          previousChapel && areaId === 'upper-landing'
            ? { minX: -7.7, maxX: 7.7, minZ: -8.7, maxZ: 8.7 }
            : area.bounds,
          actor,
        ) ||
        actor.health > registry.actor(spawn.actor).maxHealth
      )
        throw new Error(`invalid actor ${areaId}/${spawn.id}`);
    }
    if (state.cleared !== Object.values(state.actors).every((a) => a.health === 0))
      throw new Error(`inconsistent clear state ${areaId}`);
  }
  // New chapel bounds and dressing can obstruct a formerly valid position. Keep progress
  // and vital state, but restore roots to named supports rather than inside art.
  if (!isSupportedPosition(active, save.player, 0.3)) {
    const entry = active.entries.find((e) => e.id === active.baselineEntry)!;
    save.player.x = entry.x;
    save.player.z = entry.z;
  }
  for (const [areaId, state] of Object.entries(save.areas)) {
    const area = resolve(areaId);
    for (const spawn of area.spawns) {
      const actor = state.actors[spawn.id]!;
      if (!isSupportedPosition(area, actor, Math.max(0.3, registry.actor(spawn.actor).radius))) {
        actor.x = spawn.x;
        actor.z = spawn.z;
      }
    }
  }
  return save;
}
export function parseSettings(value: unknown): Settings {
  if (typeof value === 'object' && value !== null && 'version' in value && value.version === 1) {
    const v = z
      .object({
        version: z.literal(1),
        renderScale: z.number().min(0.5).max(1),
        showDebug: z.boolean(),
      })
      .strict()
      .parse(value);
    return SettingsSchema.parse({
      ...v,
      version: 5,
      verticalSpan: 9,
      depthOfField: 1,
      visualEffects: defaultVisualEffects(),
    });
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    (value.version === 2 || value.version === 3)
  ) {
    const schema = SettingsSchema.omit({ visualEffects: true }).extend({
      version: z.literal(3),
      verticalSpan: z.number().min(11).max(15),
    });
    const legacy =
      value.version === 2
        ? schema
            .omit({ depthOfField: true })
            .extend({ version: z.literal(2) })
            .parse(value)
        : schema.parse(value);
    return SettingsSchema.parse({
      ...legacy,
      version: 5,
      visualEffects: defaultVisualEffects(),
      verticalSpan: legacy.verticalSpan === 11 ? 9 : legacy.verticalSpan,
      depthOfField: 'depthOfField' in legacy ? legacy.depthOfField : 1,
    });
  }
  if (typeof value === 'object' && value !== null && 'version' in value && value.version === 4) {
    const legacy = SettingsSchema.omit({ visualEffects: true })
      .extend({ version: z.literal(4) })
      .parse(value);
    return SettingsSchema.parse({ ...legacy, version: 5, visualEffects: defaultVisualEffects() });
  }
  return SettingsSchema.parse(value);
}
export type LoadResult<T> =
  | { status: 'empty' }
  | { status: 'ok' | 'recovered'; data: T }
  | { status: 'unreadable'; message: string };
export interface Bridge {
  readonly automatedRun?: boolean;
  launchMode?(mode: 'game' | 'sandbox' | 'effects'): Promise<void>;
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
