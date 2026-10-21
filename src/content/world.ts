import {
  awarenessSchema,
  campfireSchema,
  interactableSchema,
  rewardSchema,
  type CampfireDefinition,
  type InteractableDefinition,
} from './interactions';
import type { Reward } from './items';
import { contains, clearSegment, effectiveRadius, isSupportedPosition } from './collision';
import { polygonArea } from './polygon';
import { contentSnapshot, type ContentSnapshot } from './snapshot';
import type { AuthoredGameplay } from './authored-gameplay';
import { tuning } from './gameplay';

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
type AttackTiming = {
  windup: number;
  activeEnd: number;
  total: number;
  range: number;
  damage: number;
};
export type AttackDefinition = AttackTiming &
  (
    | { kind: 'melee'; sweepRange?: number; halfAngle: number }
    | { kind: 'rib-lane'; length: number; width: number; cooldown: number }
  );
export type ActorDefinition = {
  id: string;
  kind: 'hero' | 'enemy';
  maxHealth: number;
  radius: number;
  speed: number;
  attack: AttackDefinition;
  visual: string;
  // Physical hits cannot interrupt this actor; the lantern pulse still can.
  poise?: boolean;
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
  /** Finite rendered floor; camera coverage never extends beyond it. */
  sceneBoundary?: readonly Point[];
  playableBoundary?: readonly Point[];
  surface: Surface;
  seedOffset: number;
  activation?: Bounds;
  baselineEntry: string;
  entries: readonly (Point & { id: string })[];
  spawns: readonly (Omit<AuthoredGameplay['spawns'][number], 'rewards'> & {
    rewards?: readonly Reward[];
  })[];
  exits: readonly AuthoredGameplay['exits'][number][];
  props: readonly PropDefinition[];
  campfires?: readonly CampfireDefinition[];
  interactables?: readonly InteractableDefinition[];
  pickups?: readonly AuthoredGameplay['pickups'][number][];
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
  if (s.end === s.start) return s.startHeight;
  const t = Math.max(0, Math.min(1, ((s.axis === 'x' ? x : z) - s.start) / (s.end - s.start)));
  if (s.kind === 'stairs' && s.terraceBounds) {
    if (contains(s.terraceBounds, { x, z })) return s.endHeight;
    const along = s.axis === 'x' ? x : z,
      across = s.axis === 'x' ? z : x;
    if (
      Math.abs(across) > (s.stairWidth ?? 3.2) / 2 ||
      along < Math.min(s.start, s.end) ||
      along > Math.max(s.start, s.end)
    )
      return s.startHeight;
  }
  const steps = s.steps ?? 3,
    supported = s.kind === 'stairs' ? Math.ceil(t * steps - 1e-9) / steps : t;
  return s.startHeight + (s.endHeight - s.startHeight) * supported;
}
// Segment parameters at surface discontinuities and requested height levels.
// Between these cuts, comparisons against those levels have a constant result.
export function heightBreakpoints(
  area: AreaDefinition,
  start: Point,
  end: Point,
  levels: readonly number[],
) {
  const cuts: number[] = [],
    s = area.surface;
  if (s.kind === 'flat') return cuts;
  const axis = (name: 'x' | 'z', value: number) => {
    const delta = end[name] - start[name];
    if (!delta) return;
    const t = (value - start[name]) / delta;
    if (Number.isFinite(t) && t > 0 && t < 1) cuts.push(t);
  };
  axis(s.axis, s.start);
  axis(s.axis, s.end);
  if (s.kind === 'ramp') {
    if (s.endHeight !== s.startHeight)
      for (const level of levels)
        axis(
          s.axis,
          s.start + ((level - s.startHeight) * (s.end - s.start)) / (s.endHeight - s.startHeight),
        );
  } else {
    const steps = s.steps ?? 3;
    for (let i = 0; i < steps; i++)
      axis(s.axis, s.start + ((i + 1e-9) * (s.end - s.start)) / steps);
    if (s.terraceBounds) {
      axis('x', s.terraceBounds.minX);
      axis('x', s.terraceBounds.maxX);
      axis('z', s.terraceBounds.minZ);
      axis('z', s.terraceBounds.maxZ);
      const across = s.axis === 'x' ? 'z' : 'x';
      axis(across, -(s.stairWidth ?? 3.2) / 2);
      axis(across, (s.stairWidth ?? 3.2) / 2);
    }
  }
  return cuts;
}
export function surfaceGradient(area: AreaDefinition, x: number, z: number) {
  const s = area.surface;
  if (s.kind === 'flat' || s.kind === 'stairs') return { x: 0, z: 0 };
  const p = s.axis === 'x' ? x : z,
    inside = p > Math.min(s.start, s.end) && p < Math.max(s.start, s.end),
    slope = inside ? (s.endHeight - s.startHeight) / (s.end - s.start) : 0;
  return { x: s.axis === 'x' ? slope : 0, z: s.axis === 'z' ? slope : 0 };
}
export function isValidCampfireEntry(
  area: AreaDefinition,
  fire: { x: number; z: number; safeRadius: number },
  entry: Point,
) {
  // Entry sits inside the fire's safe radius and within the shared 1.6 cap.
  // The cap is inclusive: an authored entry exactly at it remains admissible.
  // The arrival segment uses the same actor clearance as endpoints and movement,
  // so a thin wall sliver between entry and fire cannot pass validation while
  // blocking the hero.
  const distance = Math.hypot(entry.x - fire.x, entry.z - fire.z);
  return (
    distance < fire.safeRadius &&
    distance <= 1.6 &&
    isSupportedPosition(area, entry, 0.3) &&
    Math.abs(heightAt(area, entry.x, entry.z) - heightAt(area, fire.x, fire.z)) <=
      tuning.maxCombatHeightDifference &&
    clearSegment(area, entry, fire, 0.3)
  );
}
const ids = /^[a-z0-9][a-z0-9_-]*$/;
const fail = (message: string): never => {
  throw new Error(`content: ${message}`);
};
const assertFinite = (...values: number[]) => {
  if (values.some((v) => !Number.isFinite(v))) fail('non-finite value');
};
// Collision queries read polygon edges directly. Coordinates that are finite
// but large enough to overflow the polygon's own area leave those edges
// unusable, and a zero-area ring collapses to a line with an inverted
// outward normal, so the shape itself must stay measurable and nonempty.
const assertPolygon = (points: readonly Point[] | undefined) => {
  if (
    !points ||
    points.length < 3 ||
    points.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.z)) ||
    !Number.isFinite(polygonArea(points)) ||
    polygonArea(points) === 0
  )
    fail('invalid terrain polygon');
};
const assertUnique = <T extends { id: string }>(items: readonly T[], label: string) => {
  const seen = new Set<string>();
  for (const v of items) {
    if (!ids.test(v.id) || seen.has(v.id)) fail(`invalid or duplicate ${label} ID ${v.id}`);
    seen.add(v.id);
  }
};
const assertBounds = (b: Bounds) => {
  assertFinite(b.minX, b.maxX, b.minZ, b.maxZ);
  if (b.minX >= b.maxX || b.minZ >= b.maxZ) fail('invalid bounds');
};
function assertActor(a: ContentSnapshot<ActorDefinition>) {
  assertFinite(
    a.maxHealth,
    a.radius,
    a.speed,
    a.attack.windup,
    a.attack.activeEnd,
    a.attack.total,
    a.attack.range,
    a.attack.damage,
  );
  if (
    (a.kind !== 'hero' && a.kind !== 'enemy') ||
    !Number.isInteger(a.maxHealth) ||
    a.maxHealth <= 0 ||
    a.radius <= 0 ||
    a.speed <= 0 ||
    (a.poise !== undefined && typeof a.poise !== 'boolean') ||
    !ids.test(a.visual)
  )
    fail(`invalid actor ${a.id}`);
  const m = a.attack;
  if (
    ![m.windup, m.activeEnd, m.total, m.damage].every(Number.isInteger) ||
    m.windup < 0 ||
    m.activeEnd <= m.windup ||
    m.total <= m.activeEnd ||
    m.range <= 0 ||
    m.damage <= 0
  )
    fail(`invalid attack ${a.id}`);
  if (m.kind === 'melee') {
    assertFinite(m.halfAngle, m.sweepRange ?? m.range);
    if (
      (m.sweepRange !== undefined && m.sweepRange <= 0) ||
      m.halfAngle <= 0 ||
      m.halfAngle > Math.PI
    )
      fail(`invalid melee ${a.id}`);
  } else if (
    m.kind !== 'rib-lane' ||
    a.kind !== 'enemy' ||
    m.length <= 0 ||
    m.width <= 0 ||
    !Number.isInteger(m.cooldown) ||
    m.cooldown < m.total
  )
    fail(`invalid rib lane ${a.id}`);
  if (m.kind === 'rib-lane') assertFinite(m.length, m.width, m.cooldown);
}
function assertArea(
  a: ContentSnapshot<AreaDefinition>,
  actor: (id: string) => { kind: 'hero' | 'enemy'; radius: number },
  playerRadius: number,
) {
  assertBounds(a.bounds);
  if (a.activation) assertBounds(a.activation);
  for (const points of [a.sceneBoundary, a.playableBoundary]) {
    if (!points) continue;
    if (points.length < 3 || points.length > 16) fail('invalid playable boundary');
    for (const [i, p] of points.entries()) {
      assertFinite(p.x, p.z);
      const b = points[(i + 1) % points.length]!;
      if (
        !contains(a.bounds, p) ||
        points.some(
          (c, j) =>
            j !== i &&
            j !== (i + 1) % points.length &&
            (b.x - p.x) * (c.z - p.z) - (b.z - p.z) * (c.x - p.x) <= 1e-8,
        )
      )
        fail('playable boundary must be strictly convex and counterclockwise');
    }
  }
  assertFinite(a.seedOffset, a.floorColor);
  if (!Number.isInteger(a.seedOffset) || a.seedOffset < 0) fail('invalid seed offset');
  assertUnique(a.entries, 'entry');
  assertUnique(a.spawns, 'spawn');
  assertUnique(a.exits, 'exit');
  assertUnique(a.props, 'prop');
  assertUnique(a.pickups ?? [], 'pickup');
  assertUnique(a.campfires ?? [], 'campfire');
  assertUnique(a.interactables ?? [], 'interactable');
  for (const fire of a.campfires ?? []) {
    campfireSchema.parse(fire);
    if (!isSupportedPosition(a, fire, 0.3)) fail('Unsupported campfire ' + fire.id);
    const entry = a.entries.find((entry) => entry.id === 'fire-' + fire.id);
    if (!entry || !isValidCampfireEntry(a, fire, entry)) fail('Invalid campfire entry ' + fire.id);
  }
  for (const object of a.interactables ?? []) {
    interactableSchema.parse(object);
    if (!isSupportedPosition(a, object, 0.1)) fail('Unsupported interactable ' + object.id);
  }
  for (const p of a.pickups ?? []) {
    assertFinite(p.x, p.z, p.amount, p.radius);
    if (
      !contains(a.bounds, p) ||
      !isSupportedPosition(a, p, 0.01) ||
      p.kind !== 'health' ||
      !Number.isInteger(p.amount) ||
      p.amount <= 0 ||
      p.radius <= 0
    )
      fail('invalid pickup ' + p.id);
  }
  for (const p of [...a.entries, ...a.spawns]) {
    assertFinite(p.x, p.z);
    if (!contains(a.bounds, p)) fail(`point outside ${a.id}`);
  }
  if (!a.entries.some((e) => e.id === a.baselineEntry)) fail(`missing baseline entry ${a.id}`);
  const s = a.surface;
  if (s.kind === 'flat') assertFinite(s.height);
  else {
    if (s.kind !== 'ramp' && s.kind !== 'stairs') fail(`invalid surface ${a.id}`);
    if (s.axis !== 'x' && s.axis !== 'z') fail(`invalid surface axis ${a.id}`);
    if (s.kind === 'stairs') {
      const steps = s.steps ?? 3;
      if (!Number.isInteger(steps) || steps < 1 || steps > 12) fail('invalid stairs');
      if (s.terraceBounds) assertBounds(s.terraceBounds);
      if (s.stairWidth !== undefined) {
        assertFinite(s.stairWidth);
        if (s.stairWidth <= 0) fail('invalid stair width');
      }
    }
    assertFinite(s.start, s.end, s.startHeight, s.endHeight);
    if (s.start === s.end || Math.abs((s.endHeight - s.startHeight) / (s.end - s.start)) > 0.5)
      fail(`invalid shallow ramp ${a.id}`);
  }
  for (const p of a.spawns) {
    if (actor(p.actor).kind !== 'enemy') fail('encounter spawn must be an enemy');
    if (p.awareness) awarenessSchema.parse(p.awareness);
    p.rewards?.forEach((r) => {
      rewardSchema.parse(r);
    });
    assertFinite(p.jitterZ ?? 0);
    if ((p.jitterZ ?? 0) < 0 || p.z + (p.jitterZ ?? 0) > a.bounds.maxZ)
      fail('invalid spawn jitter');
  }
  for (const p of a.props) {
    if (
      p.kind !== 'pillar' &&
      p.kind !== 'tree' &&
      p.kind !== 'wall' &&
      p.kind !== 'foreground' &&
      p.kind !== 'border'
    )
      fail(`invalid prop kind ${p.id}`);
    if (p.blocking !== undefined && typeof p.blocking !== 'boolean')
      fail(`invalid prop blocking ${p.id}`);
    if (p.shape !== undefined && p.shape !== 'box' && p.shape !== 'polygon')
      fail(`invalid prop shape ${p.id}`);
    if (p.shape === 'polygon') assertPolygon(p.polygon);
    if (p.shape === 'box' && (!p.size || p.size.length !== 2))
      fail(`box footprint requires size [width, length]`);
    assertFinite(p.x, p.z, p.radius, p.height, p.rotation ?? 0, ...(p.size ?? []));
    if (p.radius <= 0 || p.height <= 0 || p.size?.some((v) => v <= 0)) fail(`invalid prop ${p.id}`);
  }
  for (const e of a.exits) {
    assertBounds(e.trigger);
    assertFinite(e.marker.x, e.marker.z);
    if (e.explicit && !isSupportedPosition(a, e.marker, 0.01))
      fail('Unsupported exit marker ' + e.id);
    if (
      !contains(a.bounds, { x: e.trigger.minX, z: e.trigger.minZ }) ||
      !contains(a.bounds, { x: e.trigger.maxX, z: e.trigger.maxZ })
    )
      fail(`exit outside ${a.id}`);
  }
  // Acceptance covers every transition entry and every possible seeded spawn,
  // using the same actor clearance as movement and checkpoint validation.
  for (const entry of a.entries)
    if (!isSupportedPosition(a, entry, playerRadius)) fail(`unsupported entry ${a.id}/${entry.id}`);
  for (const spawn of a.spawns)
    if (
      !clearSegment(
        a,
        spawn,
        { x: spawn.x, z: spawn.z + (spawn.jitterZ ?? 0) },
        effectiveRadius(actor(spawn.actor).radius),
      )
    )
      fail(`unsupported spawn ${a.id}/${spawn.id}`);
}
export class ContentRegistry {
  readonly definitions: ContentSnapshot<ContentDefinitions>;
  #areas = new Map<AreaId, ContentSnapshot<AreaDefinition>>();
  #actors = new Map<string, ContentSnapshot<ActorDefinition>>();
  constructor(draft: ContentDefinitions) {
    const definitions = contentSnapshot(draft);
    this.definitions = definitions;
    assertUnique(definitions.actors, 'actor');
    assertUnique(definitions.areas, 'area');
    for (const a of definitions.actors) {
      assertActor(a);
      this.#actors.set(a.id, a);
    }
    if (this.actor(definitions.player).kind !== 'hero') fail('player must use a hero definition');
    const playerRadius = effectiveRadius(this.actor(definitions.player).radius);
    const actor = (id: string) => {
      const value = this.#actors.get(id);
      if (!value) fail(`unknown actor ${id}`);
      return value as { kind: 'hero' | 'enemy'; radius: number };
    };
    for (const a of definitions.areas) {
      assertArea(a, actor, playerRadius);
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
