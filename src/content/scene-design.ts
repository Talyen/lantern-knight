import type { Bounds } from './world';
import type { ArtPlacement, WorldVisualDefinition } from './world-art';
import { sceneArtFindings, solidIntersection } from './scene-art-validation';

export type SceneProfile = 'graveyard' | 'chapel';
type DesignZone = {
  kind: 'focal' | 'supporting' | 'framing' | 'clear';
  bounds: Bounds;
  capacity: number;
};
type Socket = { offset: readonly [number, number, number]; accepts: readonly string[] };
type ScenePaletteEntry = {
  profiles: readonly SceneProfile[];
  category: 'shell' | 'tree' | 'vegetation' | 'grave' | 'furniture' | 'fixture' | 'ground-panel';
  dimensions: readonly [number, number, number];
  footprint: readonly [number, number] | null;
  scale: readonly [number, number];
  mirror: boolean;
  sockets?: Readonly<Record<string, Socket>>;
};
const both = ['graveyard', 'chapel'] as const;
const entry = (
  profiles: readonly SceneProfile[],
  category: ScenePaletteEntry['category'],
  dimensions: ScenePaletteEntry['dimensions'],
  footprint: ScenePaletteEntry['footprint'],
  sockets?: ScenePaletteEntry['sockets'],
): ScenePaletteEntry => ({
  profiles,
  category,
  dimensions,
  footprint,
  scale: category === 'shell' || category === 'ground-panel' || sockets ? [1, 1] : [0.85, 1.15],
  mirror: false,
  sockets,
});
const scenePalette: Readonly<Record<string, ScenePaletteEntry>> = {
  'ink-stage-chapel-exterior:shell': entry(['graveyard'], 'shell', [5.8, 5.4, 6], null),
  'ink-stage-chapel-interior:shell': entry(['chapel'], 'shell', [6, 4.9, 4], null),
  'ink-stage-road:panel': entry(['graveyard'], 'ground-panel', [4, 0, 4], null),
  'ink-tended-marker:marker': entry(['graveyard'], 'grave', [0.7, 1.2, 0.4], [0.55, 0.3]),
  'ink-tended-fragments:fragments': entry(['graveyard'], 'grave', [1.3, 0.5, 0.8], [1.15, 0.75]),
  'ink-scenery:gravestone': entry(['graveyard'], 'grave', [0.7, 1.1, 0.4], [0.55, 0.3]),
  'ink-scenery:memorial': entry(['graveyard'], 'grave', [0.8, 1.4, 0.5], [0.55, 0.3]),
  'ink-scenery:tomb': entry(both, 'grave', [1.1, 1.2, 2.3], [0.95, 2.25]),
  'ink-blackwood-oak:oak': entry(both, 'tree', [4, 5.8, 3], [0.65, 0.65]),
  'ink-blackwood-woodland:woodland': entry(both, 'tree', [6, 4.1, 4], null),
  'ink-tended-woodland-near:woodland-near': entry(both, 'tree', [5, 4, 3], null),
  'ink-tended-understory:understory': entry(both, 'vegetation', [2, 1.1, 1.5], null),
  'ink-scenery:fern': entry(both, 'vegetation', [1.2, 0.7, 1], null),
  'ink-graveyard-scenery:crook-lamp': entry(['graveyard'], 'fixture', [0.5, 2.3, 0.5], [0.2, 0.2]),
  'ink-graveyard-scenery:lantern-hardware': entry(['graveyard'], 'fixture', [0.4, 0.6, 0.4], null),
  'ink-graveyard-scenery:cresset-hardware': entry(['graveyard'], 'fixture', [0.5, 1.2, 0.5], null),
  'ink-chapel-pew:pew': entry(['chapel'], 'furniture', [1.9, 1.1, 0.85], [1.9, 0.85]),
  'ink-chapel-broken-pew:broken-pew': entry(
    ['chapel'],
    'furniture',
    [2.05, 0.8, 1.05],
    [2.05, 1.05],
  ),
  'ink-chapel-collapse:collapse': entry(['chapel'], 'furniture', [1.6, 1.5, 2.5], [1.6, 2.5]),
  'ink-chapel-altar:altar': entry(['chapel'], 'furniture', [2.4, 1.15, 1.2], [2.4, 1.2], {
    votive: { offset: [-0.07, 1.15, 0.08], accepts: ['ink-crypt:votive-hardware'] },
  }),
  'ink-scenery:offering-table': entry(both, 'furniture', [1.1, 0.8, 0.9], [0.85, 0.75], {
    votive: { offset: [-0.07, 0.8, 0.08], accepts: ['ink-crypt:votive-hardware'] },
  }),
  'ink-crypt:votive-hardware': entry(['chapel'], 'fixture', [0.4, 0.55, 0.4], null),
  'ink-crypt:doorway': entry(['chapel'], 'shell', [1.6, 2.6, 0.2], null),
};
const zone = (
  kind: DesignZone['kind'],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  capacity: number,
): DesignZone => ({ kind, bounds: { minX, maxX, minZ, maxZ }, capacity });
export const sceneDesignProfiles: Readonly<
  Record<SceneProfile, { floor: string; zones: Readonly<Record<string, DesignZone>> }>
> = {
  graveyard: {
    floor: 'ink-stage-earth',
    zones: {
      destination: zone('focal', -3.5, 3.5, -9, -4.8, 5),
      'west-burials': zone('supporting', -6.7, -3, -4.8, 3.5, 10),
      'east-burials': zone('supporting', 3, 6.7, -4.8, 3.5, 10),
      'woodland-west': zone('framing', -11, -6.8, -10, 12, 6),
      'woodland-east': zone('framing', 6.8, 11, -10, 12, 6),
      'woodland-rear': zone('framing', -6.8, 6.8, -12, -9.1, 3),
      arrival: zone('focal', -5, 2, 5.5, 8.5, 2),
      route: zone('clear', -2.5, 2.5, -6.5, 8.5, 0),
    },
  },
  chapel: {
    floor: 'ink-stage-stone',
    zones: {
      sanctuary: zone('focal', -3.5, 3.5, -10, -5.8, 4),
      'west-pews': zone('supporting', -5.3, -3, 1.5, 6.8, 3),
      'east-pews': zone('supporting', 3, 5.3, 1.5, 6.8, 3),
      devotional: zone('supporting', -5.4, -3, -6.4, -3, 2),
      collapse: zone('supporting', 3.8, 5.6, -2, 1.5, 2),
      'east-memorial': zone('supporting', 3.5, 5.4, -7, -3, 2),
      'woodland-west': zone('framing', -11, -7, -12, 11, 3),
      'woodland-east': zone('framing', 7, 11, -12, 11, 3),
      entry: zone('focal', -2.5, 2.5, 7, 9.5, 2),
      nave: zone('clear', -2.5, 2.5, -5.7, 7, 0),
    },
  },
};
const contains = (b: Bounds, x: number, z: number) =>
  x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
export function paletteEntry(p: Pick<ArtPlacement, 'asset' | 'clip'>) {
  return scenePalette[p.asset + ':' + p.clip];
}
export function deriveScenePlacement(p: ArtPlacement): ArtPlacement {
  const e = paletteEntry(p);
  if (!e) throw new Error(`Uncurated scene artwork: ${p.asset}/${p.clip}`);
  return {
    ...p,
    footprint: e.footprint
      ? [e.footprint[0] * (p.scale ?? 1), e.footprint[1] * (p.scale ?? 1)]
      : undefined,
    footprintAngle: 0,
  };
}
export function validateSceneDesign(art: WorldVisualDefinition) {
  const profile = art.designProfile;
  if (!profile) throw new Error('Scene requires a design profile');
  const spec = sceneDesignProfiles[profile];
  if (art.floor !== spec.floor || art.walls.length || art.graves.length || art.overlaps?.length)
    throw new Error('Scene foundation requires authored flat ground and whole illustrated shells');
  for (const p of [...art.props, ...art.decals]) {
    const e = paletteEntry(p),
      scale = p.scale ?? 1;
    if (!e || !e.profiles.includes(profile))
      throw new Error(`${p.id}: artwork is outside the scene palette`);
    if (
      scale < e.scale[0] ||
      scale > e.scale[1] ||
      (p.mirror && !e.mirror) ||
      p.rotation ||
      p.wallFace ||
      (p.opacity !== undefined && p.opacity !== 1) ||
      (p.tint !== undefined && p.tint !== 0xffffff)
    )
      throw new Error(`${p.id}: artwork transform violates its registered treatment`);
    if (!Number.isFinite(p.x + p.z + (p.y ?? 0) + scale) || (!p.mount && (p.y ?? 0) !== 0))
      throw new Error(`${p.id}: placement is not grounded`);
    if (p.mount) {
      const parent = art.props.find((v) => v.id === p.mount!.to),
        socket = parent && paletteEntry(parent)?.sockets?.[p.mount.socket ?? ''];
      if (
        !socket ||
        !socket.accepts.includes(p.asset + ':' + p.clip) ||
        p.mount.offset.some((v, i) => Math.abs(v - socket.offset[i]!) > 1e-8) ||
        scale !== 1
      )
        throw new Error(`${p.id}: attachment differs from its registered socket`);
      if (
        art.props.some(
          (v) => v.id !== p.id && v.mount?.to === p.mount!.to && v.mount.socket === p.mount!.socket,
        )
      )
        throw new Error(`${p.id}: socket already occupied`);
    }
    const expected = e.footprint?.map((n) => n * scale);
    if (
      expected
        ? !p.footprint || expected.some((v, i) => Math.abs(v - p.footprint![i]!) > 1e-8)
        : p.footprint !== undefined
    )
      throw new Error(`${p.id}: footprint differs from curated artwork`);
    if (p.footprintAngle && p.footprintAngle !== 0)
      throw new Error(`${p.id}: footprint facing differs from artwork`);
  }
  const conflict = sceneArtFindings(art).find((f) => f.kind === 'solid-intersection');
  if (conflict) throw new Error(`${conflict.a}/${conflict.b}: structural scenery intersects`);
}

// Composition is prototype authoring guidance, separate from engine/registration safety.
export function sceneCompositionFindings(art: WorldVisualDefinition): string[] {
  if (!art.designProfile) return [];
  const spec = sceneDesignProfiles[art.designProfile],
    notes: string[] = [],
    count = new Map<string, number>();
  for (const p of [...art.props, ...art.decals]) {
    const e = paletteEntry(p),
      zone = p.zone && spec.zones[p.zone];
    if (!zone || (!p.mount && !contains(zone.bounds, p.x, p.z)))
      notes.push(`${p.id}: outside its composition zone`);
    if (e?.category !== 'ground-panel' && p.zone && zone)
      count.set(p.zone, (count.get(p.zone) ?? 0) + 1);
    if (p.footprint)
      for (const clear of Object.values(spec.zones).filter((z) => z.kind === 'clear')) {
        const b = clear.bounds;
        if (
          solidIntersection(
            {
              id: p.id,
              center: p,
              width: p.footprint[0],
              length: p.footprint[1],
              angle: p.footprintAngle ?? 0,
            },
            {
              id: 'route',
              center: { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 },
              width: b.maxX - b.minX,
              length: b.maxZ - b.minZ,
              angle: 0,
            },
          )
        )
          notes.push(`${p.id}: occupies an intended clear zone`);
      }
  }
  for (const [name, n] of count)
    if (n > spec.zones[name]!.capacity) notes.push(`${name}: dense cluster (${n} objects)`);
  return notes;
}
