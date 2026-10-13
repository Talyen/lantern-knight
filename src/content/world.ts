import { contains, clearSegment, effectiveRadius, isSupportedPosition } from './collision';
import { contentSnapshot, type ContentSnapshot } from './snapshot';

export type AreaId = string;
export type ActorId = string;
export type Point = { x: number; z: number };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
type Surface =
  | { kind: 'flat'; height: number }
  | {
      kind: 'ramp' | 'stairs';
      steps?: number;
      terraceBounds?: Bounds;
      stairWidth?: number;
      axis: 'x' | 'z';
      start: number;
      end: number;
      startHeight: number;
      endHeight: number;
    };
type MeleeDefinition = {
  windup: number;
  activeEnd: number;
  total: number;
  range: number;
  sweepRange?: number;
  halfAngle: number;
  damage: number;
};
export type ActorDefinition = {
  id: string;
  kind: 'hero' | 'enemy';
  maxHealth: number;
  radius: number;
  speed: number;
  melee: MeleeDefinition;
  visual: string;
};
type SpawnDefinition = Point & {
  id: string;
  actor: string;
  jitterZ?: number;
};
type EntryDefinition = Point & { id: string };
type ExitDefinition = {
  id: string;
  trigger: Bounds;
  destination: string;
  entry: string;
  requiresClear: boolean;
  marker: Point;
};
export type PropDefinition = Point & {
  id: string;
  kind: 'pillar' | 'tree' | 'wall' | 'foreground' | 'border';
  radius: number;
  height: number;
  size?: readonly [number, number];
  blocking?: boolean;
  shape?: 'box' | 'polygon';
  polygon?: readonly Point[];
  rotation?: number;
};
export type AreaDefinition = {
  id: AreaId;
  name: string;
  subtitle: string;
  bounds: Bounds;
  playableBoundary?: readonly Point[];
  surface: Surface;
  seedOffset: number;
  activation?: Bounds;
  baselineEntry: string;
  entries: readonly EntryDefinition[];
  spawns: readonly SpawnDefinition[];
  exits: readonly ExitDefinition[];
  props: readonly PropDefinition[];
  pickups?: readonly {
    id: string;
    object: string;
    kind: 'health';
    amount: number;
    radius: number;
    x: number;
    z: number;
  }[];
  floorColor: number;
};
export type ContentDefinitions = {
  initialArea: string;
  player: string;
  actors: readonly ActorDefinition[];
  areas: readonly AreaDefinition[];
};
export const PLAYER_ID = 'player';
export const spawnActorId = (area: AreaId, spawn: string): ActorId => `${area}/${spawn}`;
export function heightAt(area: AreaDefinition, x: number, z: number) {
  const s = area.surface;
  if (s.kind === 'flat') return s.height;
  const t = Math.max(0, Math.min(1, ((s.axis === 'x' ? x : z) - s.start) / (s.end - s.start)));
  if (s.kind === 'stairs' && s.terraceBounds) {
    if (contains(s.terraceBounds, { x, z })) return s.endHeight;
    if (
      Math.abs(x) > (s.stairWidth ?? 3.2) / 2 ||
      z < Math.min(s.start, s.end) ||
      z > Math.max(s.start, s.end)
    )
      return s.startHeight;
  }
  const supported = s.kind === 'stairs' ? Math.ceil(t * (s.steps ?? 3) - 1e-9) / (s.steps ?? 3) : t;
  return s.startHeight + (s.endHeight - s.startHeight) * supported;
}
export function surfaceGradient(area: AreaDefinition, x: number, z: number) {
  const s = area.surface;
  if (s.kind === 'flat' || s.kind === 'stairs') return { x: 0, z: 0 };
  const p = s.axis === 'x' ? x : z,
    inside = p > Math.min(s.start, s.end) && p < Math.max(s.start, s.end),
    slope = inside ? (s.endHeight - s.startHeight) / (s.end - s.start) : 0;
  return { x: s.axis === 'x' ? slope : 0, z: s.axis === 'z' ? slope : 0 };
}
export {
  contains,
  boundaryContains,
  clampToBoundary,
  supportedPosition,
  isSupportedPosition,
} from './collision';
const ids = /^[a-z0-9][a-z0-9_-]*$/;
export class ContentRegistry {
  readonly definitions: ContentSnapshot<ContentDefinitions>;
  #areas = new Map<AreaId, ContentSnapshot<AreaDefinition>>();
  #actors = new Map<string, ContentSnapshot<ActorDefinition>>();
  constructor(draft: ContentDefinitions) {
    const definitions = contentSnapshot(draft);
    this.definitions = definitions;
    const fail = (message: string): never => {
      throw new Error(`content: ${message}`);
    };
    const finite = (...values: number[]) => {
      if (values.some((v) => !Number.isFinite(v))) fail('non-finite value');
    };
    const unique = <T extends { id: string }>(items: readonly T[], label: string) => {
      const seen = new Set<string>();
      for (const v of items) {
        if (!ids.test(v.id) || seen.has(v.id)) fail(`invalid or duplicate ${label} ID ${v.id}`);
        seen.add(v.id);
      }
    };
    const bounds = (b: Bounds) => {
      finite(b.minX, b.maxX, b.minZ, b.maxZ);
      if (b.minX >= b.maxX || b.minZ >= b.maxZ) fail('invalid bounds');
    };
    unique(definitions.actors, 'actor');
    unique(definitions.areas, 'area');
    for (const a of definitions.actors) {
      finite(a.maxHealth, a.radius, a.speed, ...Object.values(a.melee));
      if (
        !Number.isInteger(a.maxHealth) ||
        a.maxHealth <= 0 ||
        a.radius <= 0 ||
        a.speed <= 0 ||
        !ids.test(a.visual)
      )
        fail(`invalid actor ${a.id}`);
      const m = a.melee;
      if (
        ![m.windup, m.activeEnd, m.total, m.damage].every(Number.isInteger) ||
        m.windup < 0 ||
        m.activeEnd <= m.windup ||
        m.total <= m.activeEnd ||
        m.range <= 0 ||
        (m.sweepRange !== undefined && m.sweepRange <= 0) ||
        m.halfAngle <= 0 ||
        m.halfAngle > Math.PI ||
        m.damage <= 0
      )
        fail(`invalid melee ${a.id}`);
      this.#actors.set(a.id, a);
    }
    if (this.actor(definitions.player).kind !== 'hero') fail('player must use a hero definition');
    for (const a of definitions.areas) {
      bounds(a.bounds);
      if (a.activation) bounds(a.activation);
      if (a.playableBoundary) {
        const points = a.playableBoundary;
        if (points.length < 3 || points.length > 16) fail('invalid playable boundary');
        for (const [i, p] of points.entries()) {
          finite(p.x, p.z);
          const b = points[(i + 1) % points.length]!,
            c = points[(i + 2) % points.length]!;
          if (
            !contains(a.bounds, p) ||
            (b.x - p.x) * (c.z - b.z) - (b.z - p.z) * (c.x - b.x) <= 1e-8
          )
            fail('playable boundary must be strictly convex and counterclockwise');
        }
      }
      finite(a.seedOffset, a.floorColor);
      if (!Number.isInteger(a.seedOffset) || a.seedOffset < 0) fail('invalid seed offset');
      unique(a.entries, 'entry');
      unique(a.spawns, 'spawn');
      unique(a.exits, 'exit');
      unique(a.props, 'prop');
      unique(a.pickups ?? [], 'pickup');
      for (const p of a.pickups ?? []) {
        finite(p.x, p.z, p.amount, p.radius);
        if (
          !contains(a.bounds, p) ||
          p.kind !== 'health' ||
          !Number.isInteger(p.amount) ||
          p.amount <= 0 ||
          p.radius <= 0
        )
          fail('invalid pickup ' + p.id);
      }
      for (const p of [...a.entries, ...a.spawns]) {
        finite(p.x, p.z);
        if (!contains(a.bounds, p)) fail(`point outside ${a.id}`);
      }
      if (!a.entries.some((e) => e.id === a.baselineEntry)) fail(`missing baseline entry ${a.id}`);
      const s = a.surface;
      if (s.kind === 'flat') finite(s.height);
      else {
        if (s.kind === 'stairs') {
          if (s.axis !== 'z' || !Number.isInteger(s.steps) || s.steps! < 1 || s.steps! > 12)
            fail('invalid stairs');
          if (s.terraceBounds) {
            bounds(s.terraceBounds);
            finite(s.stairWidth ?? 0);
            if ((s.stairWidth ?? 0) <= 0) fail('invalid stair width');
          }
        }
        finite(s.start, s.end, s.startHeight, s.endHeight);
        if (s.start === s.end || Math.abs((s.endHeight - s.startHeight) / (s.end - s.start)) > 0.5)
          fail(`invalid shallow ramp ${a.id}`);
      }
      for (const p of a.spawns) {
        if (this.actor(p.actor).kind !== 'enemy') fail('encounter spawn must be an enemy');
        finite(p.jitterZ ?? 0);
        if ((p.jitterZ ?? 0) < 0 || p.z + (p.jitterZ ?? 0) > a.bounds.maxZ)
          fail('invalid spawn jitter');
      }
      for (const p of a.props) {
        if (
          p.shape === 'polygon' &&
          (!p.polygon || p.polygon.length < 3 || p.polygon.some((v) => !Number.isFinite(v.x + v.z)))
        )
          fail('invalid terrain polygon');
        if (p.shape === 'box' && !p.size) fail('box footprint requires size');
        finite(p.x, p.z, p.radius, p.height, p.rotation ?? 0, ...(p.size ?? []));
        if (p.radius <= 0 || p.height <= 0 || p.size?.some((v) => v <= 0))
          fail(`invalid prop ${p.id}`);
      }
      for (const e of a.exits) {
        bounds(e.trigger);
        finite(e.marker.x, e.marker.z);
        if (
          !contains(a.bounds, { x: e.trigger.minX, z: e.trigger.minZ }) ||
          !contains(a.bounds, { x: e.trigger.maxX, z: e.trigger.maxZ })
        )
          fail(`exit outside ${a.id}`);
      }
      // Acceptance covers every transition entry and every possible seeded spawn,
      // using the same actor clearance as movement and checkpoint validation.
      const playerRadius = effectiveRadius(this.actor(definitions.player).radius);
      for (const entry of a.entries)
        if (!isSupportedPosition(a, entry, playerRadius))
          fail(`unsupported entry ${a.id}/${entry.id}`);
      for (const spawn of a.spawns)
        if (
          !clearSegment(
            a,
            spawn,
            { x: spawn.x, z: spawn.z + (spawn.jitterZ ?? 0) },
            effectiveRadius(this.actor(spawn.actor).radius),
          )
        )
          fail(`unsupported spawn ${a.id}/${spawn.id}`);
      this.#areas.set(a.id, a);
    }
    this.area(definitions.initialArea);
    for (const a of definitions.areas)
      for (const e of a.exits)
        if (!this.area(e.destination).entries.some((p) => p.id === e.entry))
          fail(`missing destination entry ${e.destination}/${e.entry}`);
    Object.freeze(this);
  }
  area(id: AreaId) {
    const value = this.#areas.get(id);
    if (!value) throw new Error(`content: unknown area ${id}`);
    return value;
  }
  actor(id: string) {
    const value = this.#actors.get(id);
    if (!value) throw new Error(`content: unknown actor ${id}`);
    return value;
  }
}
