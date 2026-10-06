import {tuning} from './gameplay';
import {actorVisuals, assetCatalog} from './visuals';

export type AreaId = string;
export type ActorId = string;
export type Point = {x: number; z: number};
export type Bounds = {minX: number; maxX: number; minZ: number; maxZ: number};
export type Surface =
  | {kind: 'flat'; height: number}
  | {
      kind: 'ramp';
      axis: 'x' | 'z';
      start: number;
      end: number;
      startHeight: number;
      endHeight: number;
    };
export type MeleeDefinition = {
  windup: number;
  activeEnd: number;
  total: number;
  range: number;
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
export type SpawnDefinition = Point & {
  id: string;
  actor: string;
  jitterZ?: number;
};
export type EntryDefinition = Point & {id: string};
export type ExitDefinition = {
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
};
export type AreaDefinition = {
  id: AreaId;
  name: string;
  subtitle: string;
  bounds: Bounds;
  surface: Surface;
  seedOffset: number;
  baselineEntry: string;
  entries: readonly EntryDefinition[];
  spawns: readonly SpawnDefinition[];
  exits: readonly ExitDefinition[];
  props: readonly PropDefinition[];
  floorColor: number;
};
export type ContentDefinitions = {
  initialArea: string;
  player: string;
  actors: readonly ActorDefinition[];
  areas: readonly AreaDefinition[];
};
export const PLAYER_ID = 'player';
export const spawnActorId = (area: AreaId, spawn: string): ActorId =>
  `${area}/${spawn}`;
export function heightAt(area: AreaDefinition, x: number, z: number) {
  const s = area.surface;
  if (s.kind === 'flat') return s.height;
  const t = Math.max(
    0,
    Math.min(1, ((s.axis === 'x' ? x : z) - s.start) / (s.end - s.start)),
  );
  return s.startHeight + (s.endHeight - s.startHeight) * t;
}
export function surfaceGradient(area: AreaDefinition, x: number, z: number) {
  const s = area.surface;
  if (s.kind === 'flat') return {x: 0, z: 0};
  const p = s.axis === 'x' ? x : z,
    inside = p > Math.min(s.start, s.end) && p < Math.max(s.start, s.end),
    slope = inside ? (s.endHeight - s.startHeight) / (s.end - s.start) : 0;
  return {x: s.axis === 'x' ? slope : 0, z: s.axis === 'z' ? slope : 0};
}
export function contains(bounds: Bounds, p: Point) {
  return (
    p.x >= bounds.minX &&
    p.x <= bounds.maxX &&
    p.z >= bounds.minZ &&
    p.z <= bounds.maxZ
  );
}
const ids = /^[a-z0-9][a-z0-9_-]*$/;
export class ContentRegistry {
  readonly areas = new Map<AreaId, AreaDefinition>();
  readonly actors = new Map<string, ActorDefinition>();
  constructor(public readonly definitions: ContentDefinitions) {
    const fail = (message: string): never => {
      throw new Error(`content: ${message}`);
    };
    const finite = (...values: number[]) => {
      if (values.some((v) => !Number.isFinite(v))) fail('non-finite value');
    };
    const unique = <T extends {id: string}>(
      items: readonly T[],
      label: string,
    ) => {
      const seen = new Set<string>();
      for (const v of items) {
        if (!ids.test(v.id) || seen.has(v.id))
          fail(`invalid or duplicate ${label} ID ${v.id}`);
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
        m.halfAngle <= 0 ||
        m.halfAngle > Math.PI ||
        m.damage <= 0
      )
        fail(`invalid melee ${a.id}`);
      if (
        !actorVisuals[a.visual] ||
        !assetCatalog[actorVisuals[a.visual]!.asset]
      )
        fail(`unknown visual ${a.visual}`);
      this.actors.set(a.id, a);
    }
    if (this.actor(definitions.player).kind !== 'hero')
      fail('player must use a hero definition');
    for (const a of definitions.areas) {
      bounds(a.bounds);
      finite(a.seedOffset, a.floorColor);
      if (!Number.isInteger(a.seedOffset) || a.seedOffset < 0)
        fail('invalid seed offset');
      unique(a.entries, 'entry');
      unique(a.spawns, 'spawn');
      unique(a.exits, 'exit');
      unique(a.props, 'prop');
      for (const p of [...a.entries, ...a.spawns]) {
        finite(p.x, p.z);
        if (!contains(a.bounds, p)) fail(`point outside ${a.id}`);
      }
      if (!a.entries.some((e) => e.id === a.baselineEntry))
        fail(`missing baseline entry ${a.id}`);
      const s = a.surface;
      if (s.kind === 'flat') finite(s.height);
      else {
        finite(s.start, s.end, s.startHeight, s.endHeight);
        if (
          s.start === s.end ||
          Math.abs((s.endHeight - s.startHeight) / (s.end - s.start)) > 0.5
        )
          fail(`invalid shallow ramp ${a.id}`);
      }
      for (const p of a.spawns) {
        if (this.actor(p.actor).kind !== 'enemy')
          fail('encounter spawn must be an enemy');
        finite(p.jitterZ ?? 0);
        if ((p.jitterZ ?? 0) < 0 || p.z + (p.jitterZ ?? 0) > a.bounds.maxZ)
          fail('invalid spawn jitter');
      }
      for (const p of a.props) {
        finite(p.x, p.z, p.radius, p.height, ...(p.size ?? []));
        if (p.radius <= 0 || p.height <= 0 || p.size?.some((v) => v <= 0))
          fail(`invalid prop ${p.id}`);
      }
      for (const e of a.exits) {
        bounds(e.trigger);
        finite(e.marker.x, e.marker.z);
        if (
          !contains(a.bounds, {x: e.trigger.minX, z: e.trigger.minZ}) ||
          !contains(a.bounds, {x: e.trigger.maxX, z: e.trigger.maxZ})
        )
          fail(`exit outside ${a.id}`);
      }
      this.areas.set(a.id, a);
    }
    this.area(definitions.initialArea);
    for (const a of definitions.areas)
      for (const e of a.exits)
        if (!this.area(e.destination).entries.some((p) => p.id === e.entry))
          fail(`missing destination entry ${e.destination}/${e.entry}`);
  }
  area(id: AreaId) {
    const value = this.areas.get(id);
    if (!value) throw new Error(`content: unknown area ${id}`);
    return value;
  }
  actor(id: string) {
    const value = this.actors.get(id);
    if (!value) throw new Error(`content: unknown actor ${id}`);
    return value;
  }
}
const bounds = {minX: -7.5, maxX: 7.5, minZ: -7.5, maxZ: 7.5};
const spawns = [-2.5, 0.2, 2.9].map((x, i) => ({
  id: `warden-${i + 1}`,
  actor: 'warden',
  x,
  z: -3.5,
  jitterZ: 1,
}));
const borders: PropDefinition[] = [
  {
    id: 'north-left',
    kind: 'border',
    x: -4.5,
    z: -7.5,
    radius: 0.1,
    height: 1,
    size: [6, 0.22],
    blocking: false,
  },
  {
    id: 'north-right',
    kind: 'border',
    x: 4.5,
    z: -7.5,
    radius: 0.1,
    height: 1,
    size: [6, 0.22],
    blocking: false,
  },
  {
    id: 'west',
    kind: 'border',
    x: -7.5,
    z: 0,
    radius: 0.1,
    height: 1,
    size: [0.22, 15],
    blocking: false,
  },
];
const courtProps: PropDefinition[] = [
  {id: 'pillar', kind: 'pillar', x: -2, z: 0, radius: 0.5, height: 2.4},
  {id: 'tree', kind: 'tree', x: 2.8, z: -1.8, radius: 0.45, height: 2.6},
  {id: 'corner', kind: 'wall', x: -4.2, z: -3.1, radius: 0.7, height: 1.4},
  {
    id: 'foreground',
    kind: 'foreground',
    x: 3.5,
    z: 3.7,
    radius: 0.5,
    height: 2.1,
  },
  ...borders,
];
const landingProps: PropDefinition[] = courtProps.map((p) => ({
  ...p,
  ...(p.id === 'pillar'
    ? {x: -2.2, z: 1}
    : p.id === 'tree'
      ? {z: -3.5}
      : p.id === 'corner'
        ? {z: -4.4}
        : p.id === 'foreground'
          ? {x: 4, z: 3.7}
          : {}),
}));
export const contentDefinitions: ContentDefinitions = {
  initialArea: 'court',
  player: 'lamplighter',
  actors: [
    {
      id: 'lamplighter',
      kind: 'hero',
      maxHealth: tuning.heroMaxHealth,
      radius: tuning.heroRadius,
      speed: tuning.moveSpeed,
      melee: {...tuning.attack},
      visual: 'hero',
    },
    {
      id: 'warden',
      kind: 'enemy',
      maxHealth: tuning.enemy.maxHealth,
      radius: tuning.heroRadius,
      speed: tuning.enemy.speed,
      melee: {...tuning.enemy, halfAngle: 1.1},
      visual: 'warden',
    },
    {
      id: 'heavy-warden',
      kind: 'enemy',
      maxHealth: 140,
      radius: 0.35,
      speed: 0.75,
      melee: {
        windup: 42,
        activeEnd: 46,
        total: 72,
        range: 1.25,
        halfAngle: 1.1,
        damage: 20,
      },
      visual: 'warden',
    },
  ],
  areas: [
    {
      id: 'court',
      name: 'Lamplighter’s Court',
      subtitle: 'Three wardens. Three sword stages. One light.',
      bounds,
      surface: {kind: 'flat', height: 0},
      seedOffset: 0,
      baselineEntry: 'start',
      entries: [
        {id: 'start', x: 0, z: 2.3},
        {id: 'from-landing', x: 0, z: -6.2},
      ],
      spawns,
      props: courtProps,
      floorColor: 0x34434a,
      exits: [
        {
          id: 'landing',
          trigger: {minX: -1.2, maxX: 1.2, minZ: -7.5, maxZ: -6.5},
          destination: 'upper-landing',
          entry: 'start',
          requiresClear: true,
          marker: {x: 0, z: -6.6},
        },
      ],
    },
    {
      id: 'upper-landing',
      name: 'Upper Landing',
      subtitle: 'A shallow ramp leads to the raised landing.',
      bounds,
      surface: {
        kind: 'ramp',
        axis: 'z',
        start: 0,
        end: -2,
        startHeight: 0,
        endHeight: 0.45,
      },
      seedOffset: 101,
      baselineEntry: 'start',
      entries: [{id: 'start', x: 0, z: 6.2}],
      spawns,
      props: landingProps,
      floorColor: 0x3e444e,
      exits: [
        {
          id: 'court',
          trigger: {minX: -1.2, maxX: 1.2, minZ: 6.5, maxZ: 7.5},
          destination: 'court',
          entry: 'from-landing',
          requiresClear: true,
          marker: {x: 0, z: 6.6},
        },
      ],
    },
    {
      id: 'systems-fixture',
      name: 'Systems verification fixture',
      subtitle: 'Two melee profiles. Five wardens.',
      bounds: {minX: -5, maxX: 5, minZ: -4, maxZ: 6},
      surface: {
        kind: 'ramp',
        axis: 'x',
        start: -1,
        end: 2,
        startHeight: 0,
        endHeight: 0.3,
      },
      seedOffset: 202,
      baselineEntry: 'start',
      entries: [{id: 'start', x: 0, z: 4}],
      spawns: [-3, -1.5, 0, 1.5, 3].map((x, i) => ({
        id: `fixture-${i + 1}`,
        actor: i % 2 ? 'heavy-warden' : 'warden',
        x,
        z: -2,
      })),
      props: [],
      floorColor: 0x34434a,
      exits: [],
    },
  ],
};
export const content = new ContentRegistry(contentDefinitions);
